import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys


root = Path(__file__).resolve().parent
trial = root / ('mechanics-trial-relative-argv' if '--relative-argv' in sys.argv else 'mechanics-trial')
if trial.exists():
  raise RuntimeError('Refusing to overwrite mechanics trial')
trial.mkdir()
book = trial / 'book'
shutil.copytree(root / 'book', book)
preparation = trial / 'preparation'
shutil.copytree(root / 'preparation', preparation)
manifest_path = preparation / 'manifest.json'
manifest = json.loads(manifest_path.read_bytes())
manifest['book'] = str(book)
manifest['fixture_root'] = str(trial)
manifest['preparation'] = str(preparation)
manifest['scope'] = 'Disposable CLI process / watcher mechanics trial, not GUI evidence'
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
buffer = ctypes.create_string_buffer(4096)
assert libproc.proc_pidpath(os.getpid(), buffer, len(buffer)) > 0
owner_executable = os.fsdecode(buffer.value)
observer = subprocess.Popen([sys.executable, str(root / 'watch.py'), '--gui-pid', str(os.getpid()),
  '--manifest', str(manifest_path), '--output', str(trial / 'observation'), '--timeout', '20',
  '--mechanics-trial', '--owner-executable', owner_executable], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
armed = observer.stdout.readline()
if not armed or json.loads(armed).get('status') != 'armed':
  raise RuntimeError('Observer did not arm: ' + observer.stderr.read())
environment = dict(os.environ)
for key in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'PYTHONPATH', 'VIRTUAL_ENV', 'OPENAUTHOR_PYTHON_BIN', 'OPENAUTHOR_RUNTIME_DIR'):
  environment.pop(key, None)
environment.update({'OPENAUTHOR_CODEX_BIN': '/usr/bin/false', 'OPENAUTHOR_CODEX_HOME': str(trial / 'codex-home'),
  'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'LANG': 'en_US.UTF-8', 'LC_ALL': 'en_US.UTF-8'})
worker_python = manifest['app'] + '/Contents/MacOS/../Resources/resources/runtime/python/bin/python3' if '--relative-argv' in sys.argv else manifest['python']
command = [worker_python, '-I', '-m', 'openauthor', 'proposal', 'apply-batch']
for row in manifest['scenes']:
  command.extend(['--id', row['proposal_id']])
command.append('--json')
with (trial / 'worker.stdout').open('wb') as stdout, (trial / 'worker.stderr').open('wb') as stderr:
  worker = subprocess.Popen(command, cwd=book, env=environment, stdout=stdout, stderr=stderr)
  try:
    tail, errors = observer.communicate(timeout=25)
    (trial / 'observer.stdout').write_text(armed + tail)
    (trial / 'observer.stderr').write_text(errors)
    result = json.loads((trial / 'observation/result.json').read_bytes())
    if result['result'] != 'captured_active_changed_scene_state' or result['worker']['pid'] != worker.pid:
      raise RuntimeError('Mechanics trial did not capture the exact worker: ' + result['result'])
    if worker.poll() is not None:
      raise RuntimeError('Stopped worker unexpectedly exited')
    worker.kill()
    worker.wait(timeout=10)
    recovery = subprocess.run([manifest['python'], '-I', '-m', 'openauthor', 'scene', 'list', '--json'],
      cwd=book, env=environment, capture_output=True, timeout=30)
    (trial / 'recovery.stdout.json').write_bytes(recovery.stdout)
    (trial / 'recovery.stderr').write_bytes(recovery.stderr)
    if recovery.returncode:
      raise RuntimeError('Mechanics recovery failed')
    original = preparation / 'originals'
    recovered = {row['scene_id']: hashlib.sha256((book / row['scene_path']).read_bytes()).hexdigest() for row in manifest['scenes']}
    assert all(recovered[row['scene_id']] == row['original_file_sha256'] for row in manifest['scenes'])
    assert not (book / '.openauthor/workspace/book-transaction.json').exists()
    assert (book / '.openauthor/revisions/HEAD').read_text().strip() == manifest['original_revision_head']
    assert all((book / row['proposal_path']).read_bytes() == (original / row['proposal_path']).read_bytes() for row in manifest['scenes'])
    validation = {'scope': 'Disposable CLI mechanics only; not actual GUI, signing, power loss, or clean-machine evidence',
      'observer_exit': observer.returncode, 'worker_pid': worker.pid, 'worker_exit_after_explicit_kill': worker.returncode,
      'changed_before_kill': result['changed_scene_ids'], 'active_journal': result['journal_phase'],
      'exact_scene_bytes_restored': True, 'exact_proposal_bytes_restored': True, 'original_HEAD_restored': True,
      'journal_retired': True, 'recovery_exit': recovery.returncode, 'scene_sha256': recovered}
    (trial / 'validation.json').write_text(json.dumps(validation, indent=2) + '\n')
    print(json.dumps(validation, indent=2))
  finally:
    if worker.poll() is None:
      worker.kill()
      worker.wait(timeout=10)
    if observer.poll() is None:
      observer.kill()
      observer.wait(timeout=10)
