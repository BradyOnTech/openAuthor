"""Bounded original-scene experiment: two previews and one refinement.

Run once from the repository root. Uses only the app's existing subscription;
never logs in, selects an API fallback, or changes a real manuscript. Output
artifacts are created only in a new results directory beside this script.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from openauthor.auth import get_auth_status
from openauthor.generations import list_generation_runs
from openauthor.project import initialize_project
from openauthor.proposals import apply_proposal, undo_proposal
from openauthor.scenes import add_scene, get_scene
from openauthor.style_profile import PRESETS, get_style_profile
from openauthor.writing_voice import preview_voice, refine_voice_preview, stage_voice_preview

SOURCE = '''Noor laid the survey ribbon across the table. She felt very nervous. She wanted Soren to tell her the answer, but she did not want to ask him the question directly.

"The red mark," she said. "Is that where the water will come?"

Soren put down his ruler. "That's where someone wants a fence."

His permit lay between them, folded in thirds. The green seal was still whole. Noor had not opened it. Her sister had asked her to bring it to the meeting, and that was all she had asked.

"You measured it yourself."

"I measured a line. The river wasn't available for comment."

Noor almost smiled. Outside, a handcart rattled over the loose drain cover. She looked toward the window. Her sister should have been there by four. The clock above Soren's desk had stopped at twenty past two, so it told her nothing.

He reached for the permit. Noor put two fingers on the folded edge. She was worried he would read it aloud. She did not know what it said.

"Wait," she said.

He left his hand on the table. The ruler lay beside it, with the red thread of the survey ribbon caught beneath one end.'''

FACTS = [
  "The red mark is a proposed fence line, not a known water level.",
  "The green seal is intact. Noor has not opened or read the permit.",
  "Her sister requested delivery to the meeting and was expected by four; the current time is unknown.",
  "The stopped clock reads twenty past two, not the present time.",
  "Noor stops Soren reaching for the permit; he leaves his hand on the table without opening it.",
]
FEEDBACK = (
  "Keep Soren's dry river joke and Noor's short practical questions distinct. "
  "Replace the opening explanation of nervousness with Noor's attention to the existing ribbon or sealed permit, "
  "without adding a new physical action or explaining what the objects symbolize. "
  "Do not resolve Noor's ignorance, the water level or the current time. End with the ruler and trapped red thread."
)

def main():
  output = Path(__file__).with_name("results")
  if output.exists():
    raise SystemExit("Existing evidence is never overwritten.")
  if not get_auth_status()["openai-codex"].get("authenticated"):
    raise SystemExit("Subscription authentication unavailable. No generation ran.")
  os.environ["OPENAUTHOR_PROVIDER_MAX_RETRIES"] = "0"
  report = {"source": SOURCE, "facts": FACTS, "evaluator_feedback": FEEDBACK,
    "provider": "openai-codex", "model": "gpt-5.6-luna", "strict_review": False,
    "quality_verdict": "Requires literary review; workflow success is not prose quality.",
    "implementation_sha256": hashlib.sha256((ROOT / "openauthor/writing_voice.py").read_bytes()).hexdigest()}
  output.mkdir()
  with tempfile.TemporaryDirectory(prefix="openauthor-live-refinement-") as temporary:
    paths = initialize_project(Path(temporary), name="The survey ribbon evaluation")
    add_scene(paths, title="The survey ribbon", body=SOURCE, pov="Noor")
    before = get_scene(paths, "scene-0001")
    try:
      preview = preview_voice(paths, request={"scene_id": "scene-0001", "source_text": SOURCE,
        "instruction": "Deepen the tension through subtext without extending the scene. Preserve: " + " ".join(FACTS),
        "directions": [PRESETS[0], PRESETS[2]], "provider": "openai-codex", "model": "gpt-5.6-luna"})
      report["preview"] = preview
      print("Two initial alternatives retained.", flush=True)
      refined = refine_voice_preview(paths, request={"preview_id": preview["id"], "direction_id": "direction-1",
        "feedback": FEEDBACK, "provider": "openai-codex", "model": "gpt-5.6-luna"})
      report["refined"] = refined
      assert get_scene(paths, "scene-0001") == before
      assert get_style_profile(paths) is None
      proposal = stage_voice_preview(paths, preview_id=refined["id"], direction_id="direction-1")
      assert get_scene(paths, "scene-0001") == before
      apply_proposal(paths, proposal_id=proposal["id"])
      assert get_scene(paths, "scene-0001")["body"].strip() == refined["directions"][0]["text"]
      undo_proposal(paths, proposal_id=proposal["id"])
      assert get_scene(paths, "scene-0001")["body"] == before["body"]
      report["workflow"] = "Source unchanged until apply; exact refined prose applied; undo restored source; approved profile unchanged."
    except Exception as error:
      report["error"] = str(error)
      raise
    finally:
      report["generations"] = [{key: row[key] for key in ("provider", "model", "status", "provider_attempts", "latency_ms")}
        for row in list_generation_runs(paths)]
      (output / "record.json").write_text(json.dumps(report, indent=2) + "\n")
      packet = ["# Original scene refinement review", "", "Assistant/evaluator feedback, not the author's judgment. Read before the keyed record.", "", "## Original", "", SOURCE, "", "## Required facts", ""]
      packet += ["- " + fact for fact in FACTS]
      for index, candidate in enumerate(report.get("preview", {}).get("directions", [])):
        packet += ["", f"## Initial sample {index + 1}", "", candidate["text"]]
      if "refined" in report:
        packet += ["", "## Feedback on sample 1", "", FEEDBACK, "", "## Refined sample 1", "", report["refined"]["directions"][0]["text"]]
      (output / "review.md").write_text("\n".join(packet) + "\n")
  print(report["workflow"])

if __name__ == "__main__":
  main()
