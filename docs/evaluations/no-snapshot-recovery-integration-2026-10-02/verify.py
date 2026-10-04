#!/usr/bin/env python3
"""Validate this bounded integration packet without deployment or package installs."""
import gzip
import hashlib
import json
from pathlib import Path
import tarfile

packet = Path(__file__).resolve().parent
root = packet.parents[2]
sha = lambda data: hashlib.sha256(data).hexdigest()
checks = 0
for name, digest in json.loads((packet / "evidence-sha256.json").read_text()).items():
    assert Path(name).name == name, name
    assert sha((packet / name).read_bytes()) == digest, name
    checks += 1
manifest = json.loads((packet / "source-sha256.json").read_text())
with tarfile.open(packet / "tested-source.tar.gz") as archive:
    members = archive.getmembers()
    assert len(members) == len(manifest)
    assert {member.name for member in members} == set(manifest)
    for member in members:
        assert member.isfile(), member.name
        assert sha(archive.extractfile(member).read()) == manifest[member.name], member.name
        assert sha((root / member.name).read_bytes()) == manifest[member.name], member.name
        checks += 2
for name, log in json.loads((packet / "results.json").read_text())["logs"].items():
    raw = gzip.decompress((packet / name).read_bytes())
    assert len(raw) == log["raw_bytes"] and sha(raw) == log["raw_sha256"], name
    checks += 1
print(f"{checks} declared evidence, archived-input, current-source and raw-log checks passed.")
