#!/usr/bin/env python3
"""Verify captured current source inputs and sealed local evidence bytes."""
from pathlib import Path
import hashlib
import json

packet = Path(__file__).resolve().parent
root = packet.parents[2]
inputs = json.loads((packet / "tested-inputs.json").read_text())["inputs"]
evidence = json.loads((packet / "evidence-files.json").read_text())["files"]
for base, entries in ((root, inputs), (packet, evidence)):
  for entry in entries:
    file = base / entry["path"]
    assert file.is_file(), f"Missing: {entry['path']}"
    assert hashlib.sha256(file.read_bytes()).hexdigest() == entry["sha256"], f"Changed: {entry['path']}"
print(f"PASS {len(inputs)} current inputs and {len(evidence)} evidence files match captured SHA-256 bytes")
