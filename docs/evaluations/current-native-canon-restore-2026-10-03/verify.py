#!/usr/bin/env python3
"""Read-only integrity and correlation checks; never execute archived helpers."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import zipfile

PACKET = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(data):
    return json.loads(data)


def safe(name):
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts, 'Unsafe archive path: ' + name)


def read_tar(data, allow_directories=False):
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        seen = set()
        for member in archive.getmembers():
            safe(member.name)
            require(member.name not in seen, 'Duplicate archive member: ' + member.name)
            seen.add(member.name)
            if allow_directories and member.isdir():
                continue
            require(member.isfile(), 'Nonregular archive member: ' + member.name)
            result[member.name] = archive.extractfile(member).read()
    return result


def check_map(data, expected, label):
    require(set(data) == set(expected), label + ': file set differs')
    for name, sha in expected.items():
        require(digest(data[name]) == sha, label + ': hash differs: ' + name)


def check_partial(data, prefix, backup_files, counts):
    receipt = load(data[prefix + '/result.json'])
    raw = {n.removeprefix(prefix + '/raw-project/'): b for n, b in data.items()
           if n.startswith(prefix + '/raw-project/')}
    check_map(raw, receipt['staged_file_sha256'], prefix + ' raw snapshot')
    complete = {n for n, b in raw.items() if digest(b) == backup_files.get(n)}
    incomplete = set(raw) - complete
    missing = set(backup_files) - set(raw)
    require(complete == set(receipt['complete_archived_files']), prefix + ': complete differs')
    require(incomplete == set(receipt['incomplete_archived_files']), prefix + ': incomplete differs')
    require(missing == set(receipt['missing_archived_files']), prefix + ': missing differs')
    require(tuple(map(len, (complete, incomplete, missing))) == counts, prefix + ': counts differ')
    require(receipt['worker']['state'] == 'T' and receipt['worker_left_stopped'], prefix + ': stop receipt differs')
    require(receipt['destination_unpublished'] and receipt['raw_snapshot_stable'], prefix + ': publication receipt differs')
    seal = load(data[prefix + '/evidence-sha256.json'])
    check_map({n.removeprefix(prefix + '/'): b for n, b in data.items()
               if n.startswith(prefix + '/') and n != prefix + '/evidence-sha256.json'}, seal, prefix + ' original seal')
    return receipt, len(seal)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--current', action='store_true', help='Also read current core, author hashes and private bundle files')
    args = parser.parse_args()
    packet_seal = load((PACKET / 'evidence-sha256.json').read_bytes())['files']
    packet_bytes = {p.name: p.read_bytes() for p in PACKET.iterdir()
                    if p.is_file() and p.name != 'evidence-sha256.json'}
    check_map(packet_bytes, packet_seal, 'Packet seal')
    receipts = load(packet_bytes['receipts.json'])
    results = load(packet_bytes['results.json'])
    archives = {}
    for name, receipt in receipts['archives'].items():
        require(digest(packet_bytes[name]) == receipt['archive_sha256'], name + ': archive hash differs')
        data = read_tar(packet_bytes[name])
        require(len(data) == receipt['file_count'], name + ': count differs')
        check_map(data, {n: v['sha256'] for n, v in receipt['members'].items()}, name)
        for member, info in receipt['members'].items():
            require(len(data[member]) == info['bytes'], name + ': size differs: ' + member)
        archives[name] = data
    canon = archives['canon-originals.tar.gz']
    cli = archives['cli-originals.tar.gz']
    gui = archives['gui-originals.tar.gz']
    restored = archives['gui-restored-files.tar.gz']
    manifest = load(canon['preparation/manifest.json'])
    paths = set(manifest['baseline_sha256'])
    baseline = {n: canon['preparation/baseline/' + n] for n in paths}
    check_map(baseline, manifest['baseline_sha256'], 'Canon initial baseline')
    stages = {stage: {n: canon['native-run/' + stage + '/' + n] for n in paths}
              for stage in ['before-switch', 'after-switch', 'after-refused-review',
                            'before-successful-review', 'after-successful-review', 'after-invalid-validity-review']}
    fresh = stages['before-switch']
    require({n for n in paths if baseline[n] != fresh[n]} == {'manuscript/structure.json'}, 'Initial Plan file delta differs')
    old_plan = load(baseline['manuscript/structure.json'])
    new_plan = load(fresh['manuscript/structure.json'])
    require(old_plan['unassigned_scene_ids'] == [] and new_plan['unassigned_scene_ids'] == ['scene-0001', 'scene-0002'], 'Initial Plan normalization differs')
    require({k: v for k, v in old_plan.items() if k != 'unassigned_scene_ids'} ==
            {k: v for k, v in new_plan.items() if k != 'unassigned_scene_ids'}, 'Other Plan fields changed')
    for stage in ['after-switch', 'after-refused-review', 'before-successful-review']:
        require(stages[stage] == fresh, 'Canon fresh baseline differs: ' + stage)
    success = stages['after-successful-review']
    require({n for n in paths if success[n] != fresh[n]} == {'codex/memory.json'}, 'Canon success file delta differs')
    before_memory, after_memory = load(fresh['codex/memory.json']), load(success['codex/memory.json'])
    require({k: v for k, v in before_memory.items() if k != 'facts'} ==
            {k: v for k, v in after_memory.items() if k != 'facts'}, 'Other Memory fields changed')
    bf = {f['id']: f for f in before_memory['facts']}
    af = {f['id']: f for f in after_memory['facts']}
    require(set(bf) == set(af), 'Fact set changed')
    accepted = manifest['accepted_fact_id']
    suggested = manifest['suggested_fact_id']
    require(bf[suggested] == af[suggested], 'Suggested fact changed')
    require({k for k in set(bf[accepted]) | set(af[accepted]) if bf[accepted].get(k) != af[accepted].get(k)} == {'evidence', 'updated_at'}, 'Accepted raw fact delta differs')
    evidence = af[accepted]['evidence'][0]
    require((evidence['start'], evidence['end']) == (19, 63), 'Evidence offsets differ')
    require(evidence['excerpt'] == manifest['prose'][evidence['scene_id']][19:63], 'Evidence differs from prose slice')
    require(stages['after-invalid-validity-review'] == success, 'Invalid validity attempt changed captured files')
    require(af[suggested]['status'] == 'suggested', 'Invalid suggested fact accepted')
    switch = load(canon['native-run/storyline-switch.json'])
    require(switch['branch_before'] == 'master' and switch['branch_after'] != 'master', 'Storyline switch absent')
    for before, after in zip(switch['facts_before'], switch['facts_after']):
        require(before['updated_at'] == after['updated_at'] and before['edit_version'] != after['edit_version'], 'Storyline version correlation differs')
        require({k: v for k, v in before.items() if k != 'edit_version'} ==
                {k: v for k, v in after.items() if k != 'edit_version'}, 'Storyline fact payload changed')
    for stage in ['before-successful-review', 'after-successful-review', 'after-invalid-validity-review']:
        readback = load(canon['native-run/' + stage + '/readback.json'])
        check_map(stages[stage], readback['sha256'], 'Canon readback ' + stage)
        require(readback['branch'] == 'master' and readback['core_sha256'] == results['core_source_sha256'], 'Canon readback provenance differs')
    require(load(canon['native-run/native-refused-review.json'])['draft_retained_after_refusal'], 'Manual dirty-draft receipt differs')
    require(load(canon['native-run/switch-storyline-import-setup-failure.json'])['product_failure'] is False, 'Harness failure mislabeled')
    require(not results['canon']['native_screenshot_archive'] and not results['canon']['gui_replay'], 'Native capture scope overstated')
    original_cli_seal = load(cli['cli-evidence-sha256.json'])['files']
    check_map({n: b for n, b in cli.items() if n != 'cli-evidence-sha256.json'}, original_cli_seal, 'Original CLI seal')
    backup_manifest = load(cli['preparation/manifest.json'])
    zip_bytes = cli['portable-recovery.openauthor.zip']
    require(digest(zip_bytes) == backup_manifest['archive_sha256'] == results['restore']['backup_sha256'], 'Backup hash differs')
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as backup:
        zip_names = backup.namelist()
        require(len(zip_names) == len(set(zip_names)), 'Duplicate ZIP entry')
        for name in zip_names:
            safe(name)
        files = load(backup.read('openauthor-backup.json'))['files']
        require(len(files) == 402 and set(zip_names) == set(files) | {'openauthor-backup.json'}, 'Backup file set differs')
        zip_files = {n: backup.read(n) for n in files}
    check_map(zip_files, files, 'Original backup manifest')
    cli_partial, cli_seal_count = check_partial(cli, 'cli-observation', files, (44, 1, 357))
    gui_partial, gui_seal_count = check_partial(gui, 'gui-observation', files, (375, 1, 26))
    require(gui_partial['worker']['pid'] == 43443 and gui_partial['worker']['ppid'] == 41441, 'GUI owned worker differs')
    require('-I' not in gui_partial['worker']['argv'] and '-B' not in gui_partial['worker']['argv'], 'Actual GUI runtime flags differ')
    trial = load(cli['cli-trial-result.json'])
    require(trial['worker_exit_code'] == -9 and trial['retry_exit_code'] == trial['validation_exit_code'] == 0, 'CLI trial exit differs')
    require(trial['destination_absent_before_and_after_kill'] and trial['source_book_and_backup_unchanged'], 'CLI safety correlation differs')
    crash = load(gui['gui-crash.json'])
    require('ProcessLookupError' in crash['harness_outcome'] and 'No final worker signal is claimed' in crash['root_execution'], 'Crash-helper outcome overstated')
    require(all(p['terminal'] for p in crash['terminal_probe'].values()), 'Crash terminal receipt differs')
    require(crash['destination_absent_before_and_after'] and crash['partial_stage_unchanged'] and crash['source_and_zip_unchanged'], 'Crash preservation differs')
    native = load(gui['native-gui-observations.json'])
    require(native['retry_without_observer'] and native['completion_visible']['scenes'] == 64, 'Native retry receipt differs')
    invocation = load(gui['gui-verify-invocation.json'])
    require(invocation['exit_code'] == 0 and not invocation['timed_out'] and '-I' in invocation['command'] and '-B' in invocation['command'], 'Packaged verification command differs')
    readback = load(gui['gui-restored-readback.json'])
    require(readback['all_archived_project_files_byte_exact'] and readback['published_project_file_count'] == 401, 'GUI restored readback differs')
    require(readback['revision_health']['ready'] and readback['revision_health']['revision_count'] == 129, 'GUI revision readback differs')
    require(readback['startup_health']['ready'] and readback['startup_health']['errors'] == readback['startup_health']['warnings'] == 0, 'GUI startup receipt differs')
    require(readback['source_book_whole_files_unchanged'] and readback['source_book_file_count_unchanged'] == 490, 'Source preservation receipt differs')
    project = {n: b for n, b in restored.items() if not n.startswith('.git/')}
    expected_project = {n: sha for n, sha in files.items() if n != 'storylines.bundle'}
    check_map(project, expected_project, 'Published GUI project raw files')
    expected_refs = {'.git/HEAD': ('ref: ' + backup_manifest['git_head'] + '\n').encode()}
    for entry in backup_manifest['git_refs']:
        ref, sha = entry.split()
        expected_refs['.git/' + ref] = (sha + '\n').encode()
    require({n: b for n, b in restored.items() if n.startswith('.git/')} == expected_refs, 'Published raw Git refs differ')
    require(readback['git_refs'] == backup_manifest['git_refs'] and readback['git_head'] == backup_manifest['git_head'], 'Git readback differs')
    require(sum(n.startswith('.openauthor/revisions/records/') for n in project) == 129, 'Raw revision record count differs')
    source = read_tar(cli['source-book-after-backup.tar.gz'], allow_directories=True)
    source = {n.removeprefix('source-book/'): b for n, b in source.items()}
    check_map(source, backup_manifest['original_book_sha256'], 'Original source book raw snapshot')
    require(len(source) == 490, 'Source snapshot count differs')
    preservation = load(gui['root-preservation.json'])
    require(preservation['author_unchanged'] and preservation['author_before'] == preservation['author_after'] and len(preservation['author_after']) == 4, 'Author preservation differs')
    require(len(preservation['bundles']) == 2 and all(b['unchanged'] and b['immutable_files'] == 2205 and b['symlinks'] == 0 for b in preservation['bundles']), 'Bundle preservation differs')
    require(load(gui['gui-cleanup.json'])['all_owned_terminal'], 'Native cleanup receipt differs')
    require(not results['release_certified'] and not results['author_quality_claimed'] and results['all_six_priorities'] == 'in_progress', 'Scope overstated')
    if args.current:
        repo = PACKET.parents[2]
        for name, sha in manifest['module_sha256'].items():
            require(digest((repo / 'openauthor' / name).read_bytes()) == sha, 'Current core differs: ' + name)
        for name, sha in preservation['author_after'].items():
            require(digest((repo / name).read_bytes()) == sha, 'Current author artifact differs: ' + name)
        for name in ['normal', 'qa']:
            bundle_manifest = load(gui['provenance/' + name + '-app-files.json'])
            root = Path(bundle_manifest['app'])
            current, links = {}, {}
            for path in root.rglob('*'):
                if '__pycache__' in path.parts:
                    continue
                if path.is_symlink():
                    links[path.relative_to(root).as_posix()] = str(path.readlink())
                elif path.is_file():
                    current[path.relative_to(root).as_posix()] = path.read_bytes()
            check_map(current, bundle_manifest['files'], 'Current ' + name + ' immutable bundle')
            require(links == bundle_manifest['symlinks'], 'Current bundle symlinks differ')
    print(json.dumps({'result': 'passed', 'archive_members': {n: len(d) for n, d in archives.items()},
                      'original_cli_seal_files': len(original_cli_seal), 'partial_seal_files': {'cli': cli_seal_count, 'gui': gui_seal_count},
                      'published_project_files': len(project), 'revision_records': 129, 'raw_git_refs': len(expected_refs),
                      'original_source_files': len(source), 'current_comparison': args.current,
                      'scope': 'Integrity and retained receipt correlations only; no core, process, GUI or archived-helper replay',
                      'release_certified': False, 'all_six_priorities': 'in_progress'}, indent=2))


if __name__ == '__main__':
    main()
