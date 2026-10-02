"""Replay synthetic public CLI export/preview/import without touching an author book."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[3]
PROSE = "Mara opens the gate.\n\n# A literal sign stays in the prose."


def command(directory, *arguments):
  environment = {**os.environ, "PYTHONPATH": str(REPOSITORY)}
  result = subprocess.run([sys.executable, "-m", "openauthor", *map(str, arguments), "--json"],
    cwd=directory, env=environment, capture_output=True, text=True, check=True)
  return json.loads(result.stdout)


def outline(plan, scenes):
  titles = {scene["id"]: scene["title"] for scene in scenes}
  return [{"title": act["title"], "chapters": [
    {"title": chapter["title"], "scene_titles": [titles[value] for value in chapter["scene_ids"]]}
    for chapter in act["chapters"]]} for act in plan["acts"]]


def main():
  results = []
  with tempfile.TemporaryDirectory(prefix="openauthor-outline-cli-") as temporary:
    root = Path(temporary)
    original = root / "original"
    command(REPOSITORY, "init", original, "--name", "Synthetic outline round trip", "--project-id", "outline-cli-fixture")
    command(original, "plan", "act-add", "--title", "Unstarted  —  待写")
    journey = command(original, "plan", "act-add", "--title", "Journey")
    command(original, "plan", "chapter-add", "--act", journey["id"], "--title", "Unwritten")
    arrival = command(original, "plan", "chapter-add", "--act", journey["id"], "--title", "Arrival")
    scene = command(original, "scene", "add", "--title", "The gate", "--body", PROSE)
    command(original, "plan", "scene-assign", "--scene", scene["id"], "--chapter", arrival["id"])
    command(original, "plan", "chapter-add", "--act", journey["id"], "--title", "Later  plans")
    closing = command(original, "plan", "act-add", "--title", "Closing")
    command(original, "plan", "chapter-add", "--act", closing["id"], "--title", "Unwritten")
    before = command(original, "scene", "get", "--id", scene["id"])
    original_plan = command(original, "plan", "get")
    expected = outline(original_plan, [before])
    source_bytes = {file.name: file.read_bytes() for file in (original / "manuscript/scenes").glob("*.md")}
    for format in ["markdown", "docx"]:
      target = root / ("export" if format == "markdown" else "export.docx")
      exported = command(original, "manuscript", "export", "--format", format, "--target", target)
      preview = command(original, "manuscript", "preview", "--source", target)
      assert (preview["scene_count"], preview["act_count"], preview["chapter_count"]) == (1, 3, 4)
      restored = root / f"restored-{format}"
      command(REPOSITORY, "init", restored, "--name", "Synthetic restored outline", "--project-id", f"outline-restored-{format}")
      imported = command(restored, "manuscript", "import", "--source", target, "--expected-fingerprint", preview["fingerprint"])
      after = command(restored, "scene", "get", "--id", imported["scene_ids"][0])
      restored_plan = command(restored, "plan", "get")
      assert outline(restored_plan, [after]) == expected
      assert before["body"] == after["body"]
      assert source_bytes == {file.name: file.read_bytes() for file in (original / "manuscript/scenes").glob("*.md")}
      results.append({"format": format, "public_cli_export_preview_import": "passed",
        "scene_count": preview["scene_count"], "act_count": preview["act_count"], "chapter_count": preview["chapter_count"],
        "outline": expected, "preview_outline": preview["outline"], "source_fingerprint": preview["fingerprint"],
        "prose_sha256_before": hashlib.sha256(before["body"].encode()).hexdigest(),
        "prose_sha256_after": hashlib.sha256(after["body"].encode()).hexdigest(),
        "original_scene_files_unchanged": True, "preserves": exported.get("preserves", []), "losses": exported["losses"]})
  tracked = ["openauthor/import_structure.py", "openauthor/manuscript_io.py", "tests/test_outline_roundtrip.py",
    "tests/test_manuscript_io.py", "desktop/src/components/welcome/ImportStructureReview.tsx",
    "desktop/src/components/welcome/ImportStructureReview.test.tsx", "desktop/src/api.ts"]
  evidence = {"schema_version": 1, "recorded_at": datetime.now(timezone.utc).isoformat(),
    "scope": "Synthetic temporary books; no provider calls; no user book data", "results": results,
    "source_sha256": {relative: hashlib.sha256((REPOSITORY / relative).read_bytes()).hexdigest() for relative in tracked},
    "limits": ["No Word/LibreOffice editing round trip or packaged native file-dialog acceptance was performed.",
      "Explicit roles survive only while the Markdown manifest or DOCX paragraph styles remain available.",
      "Deeper outline nesting, project planning details and full-book history require a full backup."]}
  destination = Path(__file__).with_name("roundtrip.json")
  destination.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  print(f"Public CLI round trips passed for Markdown and DOCX; evidence: {destination}")


if __name__ == "__main__":
  main()
