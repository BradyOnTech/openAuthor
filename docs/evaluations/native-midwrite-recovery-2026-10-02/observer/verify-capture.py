import base64
import hashlib
import json
from pathlib import Path
import sys


observation = Path(sys.argv[1]).resolve()
result = json.loads((observation / 'result.json').read_bytes())
manifest = json.loads(Path(result['manifest']).read_bytes())
journal_bytes = (observation / 'book-transaction.json').read_bytes()
journal = json.loads(journal_bytes)
assert result['result'] == 'captured_active_changed_scene_state'
assert result['worker_left_stopped'] is True
assert journal['phase'] == result['journal_phase'] == 'active'
assert journal['id'] == result['journal_id']
assert hashlib.sha256(journal_bytes).hexdigest() == result['journal_sha256']
assert 'T' in result['worker']['state']
seal = json.loads((observation / 'evidence-sha256.json').read_bytes())
for relative, digest in seal.items():
  assert hashlib.sha256((observation / relative).read_bytes()).hexdigest() == digest, relative
for relative, digest in result['raw_files_sha256'].items():
  location = observation / 'raw-files' / relative
  assert (hashlib.sha256(location.read_bytes()).hexdigest() if location.exists() else None) == digest, relative
for relative, row in journal['files'].items():
  location = observation / 'raw-files' / relative
  current = location.read_bytes() if location.exists() else None
  allowed = [row['before'], *row['written']]
  assert current in [base64.b64decode(content, validate=True) if content is not None else None for content in allowed], relative
  if result['operation'] == 'apply-batch' and relative in manifest['baseline_sha256']:
    assert row['before'] is not None
    assert hashlib.sha256(base64.b64decode(row['before'], validate=True)).hexdigest() == manifest['baseline_sha256'][relative], relative
  elif result['operation'] == 'undo-batch':
    scene = next((scene for scene in manifest['scenes'] if scene['scene_path'] == relative), None)
    if scene:
      assert row['before'] is not None
      assert hashlib.sha256(base64.b64decode(row['before'], validate=True)).hexdigest() == result['scene_baseline_sha256'][scene['scene_id']], relative
changed = [row['scene_id'] for row in manifest['scenes'] if result['scene_sha256'][row['scene_id']] != result['scene_baseline_sha256'][row['scene_id']]]
assert changed == result['changed_scene_ids'] and changed
print(json.dumps({'scope': 'Retained raw capture correlation only; does not replay GUI or prove recovery',
  'correlations_passed': True, 'journal_phase': journal['phase'], 'journal_id': journal['id'],
  'changed_scene_ids': changed, 'unchanged_scene_ids': [row['scene_id'] for row in manifest['scenes'] if row['scene_id'] not in changed],
  'journal_files': len(journal['files']), 'sealed_files': len(seal)}, indent=2))
