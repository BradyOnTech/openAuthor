"""Check retained native interruption evidence without reading the live fixture.

This is an integrity and correlation check. It does not launch an app, invoke
the engine, reproduce a signal, replay the GUI, or certify distribution.
"""

import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import tarfile


ROOT = Path(__file__).resolve().parent
COMMIT = 'a5230979315e3e0dd665c5cae5b9af44fa399f93'


def require(condition, message):
  if not condition:
    raise ValueError(message)


def digest(data):
  return hashlib.sha256(data).hexdigest()


def read_json(relative):
  return json.loads((ROOT / relative).read_bytes())


def scene_body(data):
  return data.decode('utf-8').split('\n---\n', 1)[1].lstrip('\n')


def normalize(location):
  return posixpath.normpath(location)


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--seal', action='store_true', help='Refresh the packet integrity manifest after correlation checks pass.')
  parser.add_argument('--allow-provisional', action='store_true', help='Permit a packet that is still waiting for root observations/cleanup.')
  args = parser.parse_args()
  current_files = {p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in sorted(ROOT.rglob('*'))
    if p.is_file() and p.name != 'evidence-sha256.json' and '__pycache__' not in p.parts}
  if not args.seal:
    require(read_json('evidence-sha256.json') == current_files, 'Packet files differ from the sealed integrity manifest.')
  index = read_json('archive-index.json')
  require(index['source_commit'] == COMMIT, 'Archive source commit changed.')
  contents = {}
  with tarfile.open(fileobj=io.BytesIO((ROOT / 'inputs.tar.gz').read_bytes()), mode='r:gz') as archive:
    for row in archive:
      path = PurePosixPath(row.name)
      require(row.isfile() and not path.is_absolute() and '..' not in path.parts and row.name not in contents,
        'Archive contains an unsafe, duplicate, or non-file entry.')
      contents[row.name] = archive.extractfile(row).read()
  hashes = {name: digest(data) for name, data in sorted(contents.items())}
  require(hashes == index['members_sha256'], 'Lossless archive members differ from their hash index.')
  require(len(contents) == index['member_count'], 'Archive member count differs.')

  def data(relative):
    require(relative in contents, 'Missing retained file: ' + relative)
    return contents[relative]

  def obj(relative):
    return json.loads(data(relative))

  def verify_subseal(prefix, exceptions=()):
    seal = obj(prefix + '/evidence-sha256.json')
    for relative, expected in seal.items():
      if relative not in exceptions:
        require(digest(data(prefix + '/' + relative)) == expected, 'Historical subtree hash differs: ' + prefix + '/' + relative)
    return len(seal)

  for source in sorted((ROOT / 'receipts').rglob('*')):
    if source.is_file():
      relative = source.relative_to(ROOT / 'receipts').as_posix()
      require(source.read_bytes() == data(relative), 'Readable receipt differs from raw archive: ' + relative)
  for source in sorted((ROOT / 'observer').glob('*.py')):
    require(source.read_bytes() == data('fixture/' + source.name), 'Observer source differs from retained original.')
  manifest = obj('fixture/preparation/manifest.json')
  require(manifest['source_build_commit'] == COMMIT and manifest['provider_calls'] == 0 and manifest['pending_proposals'] == 3,
    'Fixture source, provider scope, or pending proposal count differs.')
  require(manifest['provider_keys_present'] is False and manifest['applied'] is False, 'Fixture preparation crossed its declared scope.')
  verify_subseal('fixture/preparation')
  for relative, expected in obj('fixture/prepared-sha256.json').items():
    require(digest(data('fixture/' + relative)) == expected, 'Prepared source/hash receipt differs: ' + relative)
  scenes = manifest['scenes']
  require(len(scenes) == 3 and all(row['hunks'] == 1 and row['retained_unchanged_prose'] for row in scenes), 'Unexpected fixture shape.')
  original = {}
  for relative, expected in manifest['baseline_sha256'].items():
    original[relative] = data('fixture/preparation/originals/' + relative)
    require(digest(original[relative]) == expected, 'Original whole-file baseline differs: ' + relative)
  require(len(original) == 8, 'Expected eight original baseline files.')
  proposed = {}
  for row in scenes:
    before = scene_body(original[row['scene_path']])
    proposal = json.loads(original[row['proposal_path']])
    proposed[row['scene_id']] = proposal['proposed_body']
    require(proposal['status'] == 'pending' and proposal['change_group_id'] == manifest['change_group'], 'Original proposal scope/status differs.')
    require(digest(before.encode()) == row['original_body_sha256'] and len(before.encode()) == row['original_body_bytes'], 'Original scene body differs.')
    require(digest(proposal['proposed_body'].encode()) == row['proposed_body_sha256'], 'Precise drafted body differs.')
    require(before.split('\n', 2)[2] == proposal['proposed_body'].split('\n', 2)[2], 'Retained prose changed in preparation.')
  require(original['.openauthor/revisions/HEAD'].decode().strip() == manifest['original_revision_head'], 'Original HEAD differs.')
  core = read_json('bundled-core-files.json')
  fingerprint = hashlib.sha256()
  require(core['source_commit'] == COMMIT and core['packaged_files_equal_retained_git_source'] is True, 'Core source scope differs.')
  source_python = {name.removeprefix('source/openauthor/'): blob for name, blob in contents.items()
    if name.startswith('source/openauthor/') and name.endswith('.py')}
  require(set(source_python) == set(core['files']), 'Retained source inventory differs from bundled Python modules.')
  for relative, expected in sorted(core['files'].items()):
    actual = digest(source_python[relative])
    require(actual == expected, 'Bundled/source module differs: ' + relative)
    fingerprint.update(relative.encode() + b'\0' + bytes.fromhex(actual))
  require(fingerprint.hexdigest() == core['core_source_sha256'] == manifest['bundled_core_source_sha256'], 'Core fingerprint differs.')
  flavor = obj('build/acceptance-flavor.json')
  bundle = obj('build/acceptance-core-verification.json')
  require(flavor['source_commit'] == bundle['source_commit'] == COMMIT, 'Native build source differs.')
  require(flavor['core_source_sha256'] == bundle['core_source_sha256'] == fingerprint.hexdigest(), 'Native core verification differs.')
  require(flavor['sha256']['python'] == manifest['python_sha256'] and bundle['release_certified'] is False,
    'Native runtime/signing scope differs.')
  require(flavor['identifier'].startswith('com.openauthor.acceptance.') and bundle['signed_bundle_required'] is False,
    'Alternate unsigned QA scope differs.')
  require(digest(data('build/acceptance-launcher.sh')) == flavor['sha256']['launcher'], 'Trusted launcher receipt differs.')
  applied_receipt = obj('root/applied-baseline.json')
  applied = {}
  for relative, expected in applied_receipt['whole_file_sha256'].items():
    applied[relative] = gzip.decompress(data('root/applied-baseline-final/' + relative + '.gz'))
    require(digest(applied[relative]) == expected, 'Completed applied baseline differs: ' + relative)
  require(len(applied) == 8 and applied_receipt['journal_absent'] is True, 'Applied baseline is incomplete.')
  require(applied['.openauthor/revisions/HEAD'].decode().strip() == applied_receipt['head'], 'Applied HEAD differs.')
  for row in scenes:
    require(scene_body(applied[row['scene_path']]) == proposed[row['scene_id']], 'Completed GUI apply body differs.')
    proposal = json.loads(applied[row['proposal_path']])
    require(proposal['status'] == 'applied' and proposal['applied_revision'] == applied_receipt['head'] and not proposal.get('undone_at'),
      'Completed GUI apply proposals do not share the apply Revision.')

  def verify_capture(prefix, baseline, operation, expected_files, gui=True):
    verify_subseal(prefix)
    result = obj(prefix + '/result.json')
    journal = obj(prefix + '/book-transaction.json')
    require(result['result'] == 'captured_active_changed_scene_state' and result['worker_left_stopped'] is True, 'No retained successful stop.')
    require(result['operation'] == operation and result['journal_phase'] == journal['phase'] == 'active', 'Capture is not the specified uncommitted operation.')
    require(result['journal_id'] == journal['id'] and digest(data(prefix + '/book-transaction.json')) == result['journal_sha256'], 'Raw journal correlation differs.')
    require(result['journal_file_count'] == len(journal['files']) == expected_files, 'Actual journal file count differs.')
    require(result['normal_core_calls_during_observation'] == 0 and result['production_hooks_or_monkeypatches'] is False,
      'Capture scope crossed engine-read or instrumentation boundary.')
    require(0 < result['elapsed_seconds'] <= result['timeout_seconds'] <= 60, 'Capture exceeded its declared wait bound.')
    worker = result['worker']
    require(worker['ppid'] == result['gui_or_trial_owner_pid'] == result['owner_guard']['pid'] and 'T' in worker['state'], 'Owned stopped worker correlation differs.')
    require(normalize(worker['executable']) == normalize(worker['argv'][0]) == normalize(manifest['python']), 'Worker executable differs.')
    tail = worker['argv'][1:]
    if tail and tail[0] == '-I':
      tail = tail[1:]
    require(tail[:4] == ['-m', 'openauthor', 'proposal', operation], 'Worker command differs.')
    if operation == 'apply-batch':
      ids = tail[4:-1]
      require(tail[-1] == '--json' and ids[::2] == ['--id'] * 3 and sorted(ids[1::2]) == sorted(row['proposal_id'] for row in scenes), 'Apply worker membership differs.')
    else:
      require(tail[4:] == ['--revision', applied_receipt['head'], '--json'], 'Undo worker Revision differs.')
    events = result['events']
    require(len(events) == 1 and events[0]['worker']['pid'] == worker['pid'] and events[0]['cwd'] == result['book'], 'Worker discovery/cwd guard differs.')
    snapshots = {}
    for relative, expected in result['raw_files_sha256'].items():
      if expected is None:
        snapshots[relative] = None
      else:
        snapshots[relative] = data(prefix + '/raw-files/' + relative)
        require(digest(snapshots[relative]) == expected, 'Raw stopped-worker file differs: ' + relative)
    for relative, row in journal['files'].items():
      values = [base64.b64decode(value, validate=True) if value is not None else None for value in [row['before'], *row['written']]]
      require(snapshots[relative] in values, 'Captured file is outside raw journal before/intended values.')
      if relative in baseline:
        require(values[0] == baseline[relative], 'Journal original differs from the operation baseline.')
    changed = []
    for row in scenes:
      identifier = row['scene_id']
      relative = row['scene_path']
      require(digest(baseline[relative]) == result['scene_baseline_sha256'][identifier], 'Observer scene baseline differs.')
      require(digest(snapshots[relative]) == result['scene_sha256'][identifier], 'Observer scene hash differs.')
      if snapshots[relative] != baseline[relative]:
        changed.append(identifier)
        if operation == 'apply-batch':
          require(scene_body(snapshots[relative]) == proposed[identifier], 'Interrupted apply saved unrelated prose.')
        else:
          require(snapshots[relative] == original[relative], 'Interrupted undo did not restore the exact whole scene.')
    require(changed == result['changed_scene_ids'], 'Reported changed scenes differ from retained bytes.')
    if gui:
      require(changed == ['scene-0001'] and result['scope'] == 'Unmodified QA GUI-spawned transaction worker observation', 'Actual GUI captured stage differs.')
      kill = obj('root/interrupted-' + ('apply' if operation == 'apply-batch' else 'undo') + '-kill.json')
      require(kill['worker'] == worker and kill['owner']['pid'] == result['owner_guard']['pid'], 'Exact kill receipt does not match captured worker/app.')
      require(kill['journal_sha256'] == result['journal_sha256'] and kill['changed_scene_ids'] == changed and kill['normal_core_calls_before_restart'] == 0,
        'Kill/relaunch scope or pre-relaunch raw journal differs.')
      require(kill['owner']['executable'] == manifest['app'] + '/Contents/MacOS/openauthor-desktop', 'Killed QA app differs.')
      require(all(row['ppid'] == kill['owner']['pid'] and row['argv'][-3:] == ['-m', 'openauthor', 'serve'] for row in kill['owned_sidecars']),
        'Killed sidecars were not exact owned serve children.')
    return result

  apply = verify_capture('observations/gui-apply-observation', original, 'apply-batch', 3)
  undo = verify_capture('observations/gui-undo-observation', applied, 'undo-batch', 1)
  recovery = obj('root/interrupted-apply-recovery-validation.json')
  require(recovery['raw_baseline_sha256'] == manifest['baseline_sha256'] and recovery['baseline_files_exact'] == 8 and recovery['scene_files_exact'] == 3,
    'Apply native startup raw validation differs.')
  require(recovery['proposals_exact_and_pending'] == 3 and recovery['original_HEAD_restored'] is True and recovery['journal_retired'] is True,
    'Apply startup recovery receipt is incomplete.')
  undo_recovery = obj('root/interrupted-undo-recovery-validation.json')
  require(undo_recovery['raw_checks_completed_before_successful_normal_core_reads'] is True and undo_recovery['journal_absent_before_core_readback'] is True,
    'Undo startup validation ordering is not established.')
  require(set(undo_recovery['eight_applied_baseline_files_exact']) == set(applied) and all(undo_recovery['eight_applied_baseline_files_exact'].values()),
    'Undo startup eight-file comparison differs.')
  require(undo_recovery['revision_head_exact'] == applied_receipt['head'], 'Undo startup HEAD differs.')
  for operation, baseline in (('apply', original), ('undo', applied)):
    for row in scenes:
      scene = json.loads(gzip.decompress(data(f"root/after-interrupted-{operation}-{row['scene_id']}.stdout.json.gz")))
      require(scene['id'] == row['scene_id'] and scene['body'] == scene_body(baseline[row['scene_path']]), 'Post-startup packaged readback differs.')
      require(data(f"root/after-interrupted-{operation}-{row['scene_id']}.stderr") == b'', 'Post-startup packaged readback emitted an error.')
  require(gzip.decompress(data('root/after-interrupted-undo-cli-syntax-attempt-scene-0001.stdout.json.gz')) == b'', 'Failed syntax attempt had successful stdout.')
  require(b'required: --id' in data('root/after-interrupted-undo-cli-syntax-attempt-scene-0001.stderr'), 'Missing-flag setup failure is not retained.')
  require('wrong proposal field' in applied_receipt['supersedes'], 'Partial baseline-copy setup attempt is not distinguished.')

  final_receipt = obj('root/completed-undo-final-freeze.json')
  final = {}
  for relative, expected in final_receipt['whole_file_sha256'].items():
    final[relative] = gzip.decompress(data('root/completed-undo-final/' + relative + '.gz'))
    require(digest(final[relative]) == expected, 'Completed undo final file differs: ' + relative)
  require(len(final) == 8 and final_receipt['journal_absent'] is True and final_receipt['eight_files_stable_during_capture'] is True, 'Final raw freeze is incomplete.')
  completed = obj('root/completed-undo-retry-validation.json')
  require(final['.openauthor/revisions/HEAD'].decode().strip() == final_receipt['head'] == completed['undo_revision'], 'Completed undo HEAD differs.')
  for row in scenes:
    require(final[row['scene_path']] == original[row['scene_path']] and completed['original_whole_scene_files_exact'][row['scene_id']] is True,
      'Completed undo does not restore exact original whole scene bytes.')
    proposal = json.loads(final[row['proposal_path']])
    require(proposal['status'] == 'applied' and proposal['undo_revision'] == final_receipt['head'] and proposal['undone_at'], 'Completed undo membership differs.')
    require(completed['proposals'][row['proposal_id']]['undo_revision'] == proposal['undo_revision'], 'Completed undo receipt differs from raw proposal.')
  records = {}
  for rid, expected in final_receipt['reachable_revision_record_sha256'].items():
    raw = data('root/completed-undo-final/revision-records/' + rid + '.json')
    require(digest(raw) == expected, 'Reachable Revision record differs.')
    records[rid] = json.loads(raw)
    require(records[rid]['id'] == rid, 'Revision record identity differs.')
  rid = final_receipt['head']
  visited = []
  while rid:
    require(rid not in visited and rid in records, 'Reachable Revision chain is cyclic or incomplete.')
    visited.append(rid)
    rid = records[rid]['parent']
  require(set(visited) == set(records) and len(records) == 7, 'Final reachable history differs.')
  applied_record = records[applied_receipt['head']]
  undo_record = records[final_receipt['head']]
  require(applied_record['kind'] == 'change_group_apply' and undo_record['kind'] == 'change_group_undo', 'Final history lacks coordinated apply/undo.')
  require(undo_record['parent'] == applied_record['id'] and undo_record['metadata']['applied_revision'] == applied_record['id'], 'Undo did not directly follow this shared apply.')
  for record, baseline in ((applied_record, applied), (undo_record, final)):
    require(sorted(record['metadata']['proposal_ids']) == sorted(row['proposal_id'] for row in scenes), 'Revision proposal membership differs.')
    require(record['metadata']['scene_ids'] == sorted(row['scene_id'] for row in scenes), 'Revision scene membership differs.')
    for row in scenes:
      require(record['manifest'][row['scene_path']] == digest(baseline[row['scene_path']]), 'Revision saved scene digest differs from retained whole file.')
      require(record['metadata']['proposal_scenes'][row['proposal_id']] == {'id': row['scene_id'], 'path': row['scene_path']}, 'Revision proposal-to-scene recipe differs.')

  for name in ('mechanics-trial', 'mechanics-trial-relative-argv'):
    prefix = 'mechanics/' + name
    trial_manifest = obj(prefix + '/preparation/manifest.json')
    expected_manifest = dict(manifest)
    expected_manifest.update({'book': str(PurePosixPath(manifest['fixture_root']) / name / 'book'),
      'fixture_root': str(PurePosixPath(manifest['fixture_root']) / name),
      'preparation': str(PurePosixPath(manifest['fixture_root']) / name / 'preparation'),
      'scope': 'Disposable CLI process / watcher mechanics trial, not GUI evidence'})
    require(trial_manifest == expected_manifest, 'Trial manifest differs beyond its documented private-copy rebase.')
    verify_subseal(prefix + '/preparation', exceptions=('manifest.json',))
    capture = obj(prefix + '/observation/result.json')
    require(capture['scope'] == 'CLI mechanics trial only', 'Preparatory trial is presented as GUI evidence.')
    verify_capture(prefix + '/observation', original, 'apply-batch', capture['journal_file_count'], gui=False)
    trial_validation = obj(prefix + '/validation.json')
    require(trial_validation['observer_exit'] == 0 and trial_validation['worker_exit_after_explicit_kill'] == -9 and trial_validation['recovery_exit'] == 0,
      'Preparatory CLI trial did not complete the recorded mechanics.')
    require(all(trial_validation[key] is True for key in ('exact_scene_bytes_restored', 'exact_proposal_bytes_restored', 'original_HEAD_restored', 'journal_retired')),
      'Preparatory CLI recovery receipt differs.')
  guard = obj('fixture/guard-checks.json')
  require(guard['all_matched'] is True and guard['observed'] == guard['expected'], 'Executable-path normalization guard check differs.')
  require(guard['observed']['actual_relative_gui_spelling'] is True and guard['observed']['different_executable'] is False,
    'Guard accepts a different core or rejects the actual native argv spelling.')
  require(obj('root/native-process-before.json')['application_sha256'] == flavor['sha256']['application'], 'Initial app executable SHA differs.')
  require(obj('root/native-process-before.json')['pid'] == apply['owner_guard']['pid'], 'Initial native app PID differs.')
  require(obj('root/native-process-after-interrupted-apply.json')['pid'] == undo['owner_guard']['pid'], 'Apply native relaunch does not match the undo owner.')
  require(obj('root/native-process-after-interrupted-undo.json')['pid'] != undo['owner_guard']['pid'], 'Undo relaunch did not identify a fresh app PID.')
  observations_retained = 'root/observations.json' in contents
  cleanup_retained = 'root/cleanup.json' in contents
  if not args.allow_provisional:
    require(observations_retained and cleanup_retained, 'Packet is provisional: root manual observations or cleanup are missing.')
  if observations_retained:
    observations = obj('root/observations.json')
    require(observations['source_build_commit'] == COMMIT and 'Manual transcription' in observations['method'] and 'not archived' in observations['method'],
      'Native inline observation scope is not explicit.')
    require([row['stage'] for row in observations['stages']] == ['attach_and_review', 'interrupt_apply', 'apply_native_recovery', 'complete_apply', 'interrupt_undo', 'undo_native_recovery', 'complete_undo_retry'],
      'Manual GUI stage record is incomplete.')
  if cleanup_retained:
    cleanup = obj('root/cleanup.json')
    require(cleanup['owned_qa_and_known_sidecars_absent'] is True and cleanup['survivors'] == [] and cleanup['system_settings_changed'] is False,
      'Owned QA cleanup is not established.')
    require(obj('root/author-hashes-before.json') == obj('root/author-hashes-after.json'), 'Author artifacts changed during the native drill.')
  results = read_json('results.json')
  require(results['source_commit'] == COMMIT and results['provider_calls'] == 0 and results['fixture_scenes'] == 3, 'Packet result scope differs.')
  require(results['application_sha256'] == flavor['sha256']['application'] and results['packaged_core_source_sha256'] == fingerprint.hexdigest(), 'Packet build correlations differ.')
  require(results['seal_state'] == ('final' if cleanup_retained and observations_retained else 'provisional'), 'Packet finality differs from retained receipts.')
  require(results['actual_gui_apply_capture']['active_journal_files'] == 3 and results['actual_gui_undo_capture']['active_journal_files'] == 1,
    'Packet summary substitutes another captured stage.')
  require(all(results[key] is False for key in ('native_screenshot_files_archived', 'gui_replayed_by_verifier', 'production_hooks_used', 'release_certified', 'current_new_canon_source_bundle_verified', 'all_six_priorities_complete')),
    'Packet overstates native, release, or project acceptance.')
  if args.seal:
    (ROOT / 'evidence-sha256.json').write_text(json.dumps(current_files, indent=2) + '\n')
  print(json.dumps({'result': 'retained_integrity_and_correlations_passed', 'source_commit': COMMIT,
    'packet_files': len(current_files), 'archive_members': len(contents), 'bundled_core_files': len(core['files']),
    'gui_captures': 2, 'original_and_applied_baseline_files': 8, 'final_reachable_revisions': len(records),
    'cli_mechanics_trials': 2, 'seal_state': results['seal_state'], 'gui_replayed': False, 'release_certified': False}, indent=2))


if __name__ == '__main__':
  main()
