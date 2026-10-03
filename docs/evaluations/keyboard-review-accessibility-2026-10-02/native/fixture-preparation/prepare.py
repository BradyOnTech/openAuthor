import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


app = Path('/private/tmp/openauthor-navigation-native-ae3eb2e/acceptance-ae3eb2e.app')
runtime = app / 'Contents/Resources/resources/runtime'
python = runtime / 'python/bin/python3'
installed = runtime / 'python/lib/python3.11/site-packages/openauthor'
root = Path(tempfile.mkdtemp(prefix='openauthor-native-coordinated-', dir='/private/tmp'))
book = root / 'book'
evidence = root / 'evidence'
book.mkdir()
evidence.mkdir()
(root / 'codex-home').mkdir()
env = dict(os.environ)
for key in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAUTHOR_PYTHON_BIN', 'OPENAUTHOR_RUNTIME_DIR', 'PYTHONPATH', 'VIRTUAL_ENV'):
  env.pop(key, None)
env.update({
  'OPENAUTHOR_CODEX_BIN': '/usr/bin/false',
  'OPENAUTHOR_CODEX_HOME': str(root / 'codex-home'),
  'GIT_CONFIG_GLOBAL': '/dev/null',
  'GIT_CONFIG_NOSYSTEM': '1',
  'GIT_AUTHOR_NAME': 'Native Recovery Acceptance',
  'GIT_AUTHOR_EMAIL': 'acceptance@example.invalid',
  'GIT_COMMITTER_NAME': 'Native Recovery Acceptance',
  'GIT_COMMITTER_EMAIL': 'acceptance@example.invalid',
  'PATH': str(runtime / 'git/bin') + ':' + env.get('PATH', ''),
  'LANG': 'en_US.UTF-8',
  'LC_ALL': 'en_US.UTF-8',
})
actions = []


def run(label, args):
  argv = [str(python), '-I', '-m', 'openauthor', *args]
  start = datetime.datetime.now(datetime.timezone.utc).isoformat()
  result = subprocess.run(argv, cwd=book, env=env, capture_output=True)
  (evidence / (label + '.stdout')).write_bytes(result.stdout)
  (evidence / (label + '.stderr')).write_bytes(result.stderr)
  actions.append({'label': label, 'argv': argv, 'cwd': str(book), 'started_at': start, 'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit_code': result.returncode})
  (evidence / 'actions.json').write_text(json.dumps(actions, indent=2) + '\n')
  if result.returncode:
    raise RuntimeError(label + ': ' + result.stderr.decode())
  return json.loads(result.stdout)


run('01-init', ['init', str(book), '--name', 'Native coordinated recovery acceptance', '--json'])
bodies = ['The signal began to drift.', 'Mara started to pace beside the gate.', 'Ivo really waited beside the very narrow door.']
rows = []
for number, body in enumerate(bodies, 1):
  scene = run(f'{number + 1:02d}-add-scene-{number}', ['scene', 'add', '--title', f'Recovery scene {number}', '--body', body, '--json'])
  rows.append({'scene_id': scene['id'], 'original_body': scene['body'], 'scene_path': scene['path']})
initial = evidence / 'initial-scenes'
initial.mkdir()
for row in rows:
  source = book / row['scene_path']
  target = initial / source.name
  shutil.copyfile(source, target)
  row['original_file_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
  row['original_file_evidence'] = str(target)
group = 'native-recovery-drill'
for number, row in enumerate(rows, 1):
  planned = run(f'{number * 2 + 3:02d}-generate-scene-{number}', ['proposal', 'generate', '--scene', row['scene_id'], '--instruction', 'Tighten the prose. Preserve every fact, name, action, and uncertainty. Remove unnecessary verbal scaffolding.', '--change-group', group, '--provider', 'local', '--json'])
  row['proposal_id'] = planned['id']
  drafted = run(f'{number * 2 + 4:02d}-draft-scene-{number}', ['proposal', 'draft', '--id', row['proposal_id'], '--provider', 'local', '--json'])
  (evidence / f'proposal-{number}.json').write_text(json.dumps(drafted, indent=2) + '\n')
  row['proposed_body'] = drafted['payload']['proposed_body'] if 'payload' in drafted else drafted['proposed_body']
  row['proposal_response_keys'] = sorted(drafted)
  row['proposal_group_id'] = drafted.get('change_group_id', drafted.get('payload', {}).get('change_group_id', ''))
  row['change_set_group_id'] = drafted.get('change_set', drafted.get('payload', {}).get('change_set', {})).get('group_id', '')
  if row['proposed_body'] == row['original_body']:
    raise RuntimeError('Local draft failed to differ for ' + row['scene_id'])
  if group not in (row['proposal_group_id'], row['change_set_group_id']):
    raise RuntimeError('Wrong group for ' + row['scene_id'])
  source = book / row['scene_path']
  if hashlib.sha256(source.read_bytes()).hexdigest() != row['original_file_sha256']:
    raise RuntimeError('Draft changed a scene on disk')
core_hash = hashlib.sha256()
core_files = {}
for source in sorted(installed.rglob('*.py')):
  relative = source.relative_to(installed).as_posix()
  content_hash = hashlib.sha256(source.read_bytes())
  core_files[relative] = content_hash.hexdigest()
  core_hash.update(relative.encode() + b'\0' + content_hash.digest())
manifest = {
  'schema_version': 1,
  'scope': 'Private deterministic local-provider fixture preparation only; not GUI recovery, human editorial quality, signed distribution, or clean-machine evidence.',
  'fixture_root': str(root), 'book': str(book), 'evidence': str(evidence),
  'app_path': str(app), 'source_build_commit': 'ae3eb2e44b6075c13fe1aade046b63f2dc47d8b0',
  'bundled_python': str(python), 'bundled_python_sha256': hashlib.sha256(python.read_bytes()).hexdigest(),
  'bundled_core_source_sha256': core_hash.hexdigest(), 'core_files': core_files,
  'provider': 'local', 'api_keys_removed': ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'],
  'codex_home': str(root / 'codex-home'), 'codex_bin': '/usr/bin/false',
  'change_group': group, 'scene_files_unchanged_after_drafting': True, 'applied': False,
  'scenes': rows,
}
(evidence / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
sealed = {source.relative_to(evidence).as_posix(): hashlib.sha256(source.read_bytes()).hexdigest() for source in sorted(evidence.rglob('*')) if source.is_file()}
(evidence / 'evidence-sha256.json').write_text(json.dumps(sealed, indent=2) + '\n')
print(json.dumps({'fixture_root': str(root), 'book': str(book), 'evidence': str(evidence), 'scenes': rows, 'bundled_python_sha256': manifest['bundled_python_sha256'], 'bundled_core_source_sha256': manifest['bundled_core_source_sha256']}, indent=2))
