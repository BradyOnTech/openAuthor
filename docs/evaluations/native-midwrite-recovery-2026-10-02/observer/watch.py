"""Bounded raw-journal observer for one owned native mutation worker.

Never imports openauthor, acquires its lock, or reads through core commands.
Stops only an exact worker identity after observing an active journal and changed
scene bytes. Leaves that worker stopped for root to inspect and kill explicitly.
"""

import argparse
import base64
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import time


parser = argparse.ArgumentParser()
parser.add_argument('--gui-pid', type=int, required=True)
parser.add_argument('--manifest', default=str(Path(__file__).parent / 'preparation/manifest.json'))
parser.add_argument('--output', required=True)
parser.add_argument('--timeout', type=float, default=60)
parser.add_argument('--operation', choices=('apply-batch', 'undo-batch'), default='apply-batch')
parser.add_argument('--revision')
parser.add_argument('--mechanics-trial', action='store_true')
parser.add_argument('--owner-executable')
args = parser.parse_args()
if not 0 < args.timeout <= 60 or args.gui_pid <= 1:
  parser.error('Use a live owned PID and a timeout of at most 60 seconds')
if args.operation == 'undo-batch' and not args.revision:
  parser.error('Undo observation requires the exact applied Revision')
manifest_path = Path(args.manifest).resolve()
manifest = json.loads(manifest_path.read_bytes())
root = manifest_path.parent.parent
book = Path(manifest['book']).resolve()
if not str(book).startswith('/private/tmp/openauthor-native-midwrite-') or book.is_symlink():
  raise RuntimeError('Only this private fixture family is permitted')
output = Path(args.output).resolve()
if not output.is_relative_to(root) or output == book or output.is_relative_to(book):
  raise RuntimeError('Evidence output must be outside the book under the owned fixture root')
if output.exists():
  raise RuntimeError('Refusing to overwrite earlier observation')
output.mkdir(parents=True)
expected_owner = manifest['app'] + '/Contents/MacOS/openauthor-desktop'
if args.mechanics_trial:
  if not args.owner_executable:
    parser.error('Mechanics trial requires the exact launcher executable')
  expected_owner = args.owner_executable
elif args.owner_executable:
  parser.error('Native mode always requires the exact QA executable')
expected_python = str(Path(manifest['python']).resolve())
if hashlib.sha256(Path(expected_python).read_bytes()).hexdigest() != manifest['python_sha256']:
  raise RuntimeError('Packaged Python differs from sealed preparation')
installed = Path(manifest['app']) / 'Contents/Resources/resources/runtime/python/lib/python3.11/site-packages/openauthor'
fingerprint = hashlib.sha256()
for source in sorted(installed.rglob('*.py')):
  relative = source.relative_to(installed).as_posix()
  fingerprint.update(relative.encode() + b'\0' + hashlib.sha256(source.read_bytes()).digest())
if fingerprint.hexdigest() != manifest['bundled_core_source_sha256']:
  raise RuntimeError('Packaged core differs from sealed preparation')
journal_path = book / '.openauthor/workspace/book-transaction.json'
scene_rows = manifest['scenes']
scene_paths = [book / row['scene_path'] for row in scene_rows]
before_hashes = [row['original_file_sha256'] for row in scene_rows]
if journal_path.exists():
  raise RuntimeError('Observation must be armed before a journal exists')
if args.operation == 'apply-batch' and any(hashlib.sha256(p.read_bytes()).hexdigest() != h for p, h in zip(scene_paths, before_hashes)):
  raise RuntimeError('Apply observation baseline no longer matches preparation')
if args.operation == 'undo-batch':
  before_hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in scene_paths]

libproc = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
libc = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
libproc.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
libproc.proc_pidpath.restype = ctypes.c_int
libc.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]
libc.sysctl.restype = ctypes.c_int


def executable(pid):
  buffer = ctypes.create_string_buffer(4096)
  if libproc.proc_pidpath(pid, buffer, len(buffer)) <= 0:
    raise ProcessLookupError(pid)
  return os.fsdecode(buffer.value)


def argv(pid):
  mib = (ctypes.c_int * 3)(1, 49, pid)
  capacity = ctypes.c_size_t(1024 * 1024)
  buffer = ctypes.create_string_buffer(capacity.value)
  if libc.sysctl(mib, 3, buffer, ctypes.byref(capacity), None, 0):
    raise ProcessLookupError(pid)
  raw = buffer.raw[:capacity.value]
  count = struct.unpack_from('i', raw)[0]
  if not 0 < count < 500:
    raise RuntimeError('Unexpected argument count')
  cursor = raw.find(b'\0', 4)
  while cursor < len(raw) and raw[cursor] == 0:
    cursor += 1
  values = []
  for _ in range(count):
    end = raw.find(b'\0', cursor)
    if end < 0:
      raise RuntimeError('Incomplete process argument data')
    values.append(os.fsdecode(raw[cursor:end]))
    cursor = end + 1
  return values


def details(pid):
  result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'ppid=', '-o', 'lstart=', '-o', 'stat='], capture_output=True, text=True, timeout=2)
  if result.returncode or not result.stdout.strip():
    raise ProcessLookupError(pid)
  parts = result.stdout.strip().split()
  return {'pid': pid, 'ppid': int(parts[0]), 'start': ' '.join(parts[1:-1]), 'state': parts[-1], 'executable': executable(pid), 'argv': argv(pid)}


def cwd(pid):
  result = subprocess.run(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], capture_output=True, text=True, timeout=3)
  locations = [line[1:] for line in result.stdout.splitlines() if line.startswith('n')]
  if result.returncode or len(locations) != 1:
    raise RuntimeError('Cannot verify owned worker cwd')
  return str(Path(locations[0]).resolve())


def owned_worker(row):
  if row['ppid'] != args.gui_pid or str(Path(row['executable']).resolve()) != expected_python:
    return False
  values = row['argv']
  if not values or str(Path(values[0]).resolve()) != expected_python:
    return False
  tail = values[1:]
  if tail and tail[0] == '-I':
    tail = tail[1:]
  if tail[:4] != ['-m', 'openauthor', 'proposal', args.operation]:
    return False
  tail = tail[4:]
  if args.operation == 'undo-batch':
    return tail == ['--revision', args.revision, '--json']
  if not tail or tail[-1] != '--json':
    return False
  ids = tail[:-1]
  if len(ids) != 2 * len(scene_rows) or any(ids[index] != '--id' for index in range(0, len(ids), 2)):
    return False
  return sorted(ids[1::2]) == sorted(row['proposal_id'] for row in scene_rows)


def save_result(result):
  result.update({'schema_version': 1, 'scope': 'CLI mechanics trial only' if args.mechanics_trial else 'Unmodified QA GUI-spawned transaction worker observation',
    'book': str(book), 'manifest': str(manifest_path), 'gui_or_trial_owner_pid': args.gui_pid,
    'owner_guard': owner, 'expected_worker_executable': expected_python, 'operation': args.operation,
    'normal_core_calls_during_observation': 0, 'production_hooks_or_monkeypatches': False,
    'timeout_seconds': args.timeout, 'elapsed_seconds': round(time.monotonic() - started, 4),
    'completed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'events': events})
  (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
  seal = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'evidence-sha256.json'}
  (output / 'evidence-sha256.json').write_text(json.dumps(seal, indent=2) + '\n')
  print(json.dumps({'result': result['result'], 'worker_pid': result.get('worker', {}).get('pid'),
    'changed_scenes': result.get('changed_scene_ids', []), 'journal_phase': result.get('journal_phase'),
    'worker_left_stopped': result.get('worker_left_stopped', False), 'evidence': str(output)}, indent=2), flush=True)


owner = details(args.gui_pid)
if owner['executable'] != expected_owner:
  raise RuntimeError('Supplied owner PID is not the exact QA app or explicit trial launcher')
started = time.monotonic()
deadline = started + args.timeout
events = []
candidate = None
stopped = False
print(json.dumps({'status': 'armed', 'book': str(book), 'owner_pid': args.gui_pid, 'operation': args.operation, 'deadline_seconds': args.timeout}), flush=True)
try:
  while time.monotonic() < deadline:
    if candidate is None:
      current_owner = details(args.gui_pid)
      if current_owner['executable'] != owner['executable'] or current_owner['start'] != owner['start']:
        raise RuntimeError('QA/trial owner changed during observation')
      result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid='], capture_output=True, text=True, timeout=2)
      if result.returncode:
        raise RuntimeError('Cannot enumerate owned children')
      children = [int(line.split()[0]) for line in result.stdout.splitlines() if len(line.split()) == 2 and int(line.split()[1]) == args.gui_pid]
      for pid in children:
        try:
          row = details(pid)
          if owned_worker(row) and cwd(pid) == str(book):
            candidate = row
            events.append({'event': 'exact_owned_worker_found', 'elapsed_seconds': round(time.monotonic() - started, 4), 'worker': row, 'cwd': str(book)})
            break
        except ProcessLookupError:
          continue
      if candidate is None:
        time.sleep(0.005)
        continue
    try:
      raw = journal_path.read_bytes()
      journal = json.loads(raw)
    except FileNotFoundError:
      try:
        row = details(candidate['pid'])
      except ProcessLookupError:
        save_result({'result': 'missed_timing_window', 'worker': candidate, 'worker_left_stopped': False, 'reason': 'Exact mutation worker exited before a qualifying active journal was captured'})
        raise SystemExit(2)
      time.sleep(0.002)
      continue
    scene_hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in scene_paths]
    changed = [scene_rows[index]['scene_id'] for index, actual in enumerate(scene_hashes) if actual != before_hashes[index]]
    if journal.get('phase') != 'active' or not changed:
      time.sleep(0.001)
      continue
    row = details(candidate['pid'])
    if not owned_worker(row) or row['start'] != candidate['start']:
      raise RuntimeError('Mutation worker identity changed before stop')
    os.kill(row['pid'], signal.SIGSTOP)
    stopped = True
    for _ in range(20):
      settled = details(row['pid'])
      if 'T' in settled['state']:
        break
      time.sleep(0.002)
    else:
      raise RuntimeError('Worker did not enter a stopped state')
    raw = journal_path.read_bytes()
    journal = json.loads(raw)
    scene_hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in scene_paths]
    changed = [scene_rows[index]['scene_id'] for index, actual in enumerate(scene_hashes) if actual != before_hashes[index]]
    if journal.get('phase') != 'active' or not changed:
      os.kill(row['pid'], signal.SIGCONT)
      stopped = False
      save_result({'result': 'missed_timing_window', 'worker': settled, 'worker_left_stopped': False, 'journal_phase': journal.get('phase'), 'reason': 'The worker advanced beyond active changed-scene state before SIGSTOP settled'})
      raise SystemExit(2)
    (output / 'book-transaction.json').write_bytes(raw)
    snapshots = output / 'raw-files'
    snapshot_hashes = {}
    touched = sorted(set(journal['files']) | {row['scene_path'] for row in scene_rows} | {row['proposal_path'] for row in scene_rows} | {'.openauthor/revisions/HEAD'})
    for relative in touched:
      location = book / relative
      if not location.resolve().is_relative_to(book) or location.is_symlink():
        raise RuntimeError('Unexpected unsafe journal path')
      if not location.exists():
        snapshot_hashes[relative] = None
        continue
      data = location.read_bytes()
      target = snapshots / relative
      target.parent.mkdir(parents=True, exist_ok=True)
      target.write_bytes(data)
      snapshot_hashes[relative] = hashlib.sha256(data).hexdigest()
    if journal_path.read_bytes() != raw:
      raise RuntimeError('Raw journal changed while the exact worker was stopped')
    for relative, digest in snapshot_hashes.items():
      location = book / relative
      if (hashlib.sha256(location.read_bytes()).hexdigest() if location.exists() else None) != digest:
        raise RuntimeError('Raw file changed while worker was stopped')
    save_result({'result': 'captured_active_changed_scene_state', 'worker': settled, 'worker_left_stopped': True,
      'journal_phase': journal['phase'], 'journal_id': journal['id'], 'journal_file_count': len(journal['files']),
      'journal_sha256': hashlib.sha256(raw).hexdigest(), 'changed_scene_ids': changed,
      'scene_sha256': {row['scene_id']: digest for row, digest in zip(scene_rows, scene_hashes)},
      'scene_baseline_sha256': {row['scene_id']: digest for row, digest in zip(scene_rows, before_hashes)},
      'raw_files_sha256': snapshot_hashes, 'scope_note': 'This captures an active uncommitted transaction after scene replacement. Recovery is not yet attempted or proven; root must kill this exact stopped worker and owned QA app before relaunch.'})
    raise SystemExit(0)
  save_result({'result': 'observation_timeout', 'worker': candidate or {}, 'worker_left_stopped': False, 'reason': 'No qualifying live mutation worker / active changed-scene state within the bounded wait'})
  raise SystemExit(2)
except Exception as error:
  if stopped and candidate:
    try:
      current = details(candidate['pid'])
      if owned_worker(current) and current['start'] == candidate['start']:
        os.kill(candidate['pid'], signal.SIGCONT)
        stopped = False
    except ProcessLookupError:
      stopped = False
  save_result({'result': 'observer_error', 'worker': candidate or {}, 'worker_left_stopped': stopped, 'error_type': type(error).__name__, 'error': str(error)})
  raise
