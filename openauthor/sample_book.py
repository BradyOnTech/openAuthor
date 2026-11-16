"""A small, complete book for first-time exploration, and default book locations.

The sample is created with the same public operations an author uses, so it is
an ordinary project afterwards: plain scene files, a Plan, Story Memory entries
and one Change Set waiting for review. It also plants one continuity slip so
the diagnostics have something real to find.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, initialize_project, inspect_project

SAMPLE_TITLE = "The Tide Clock (sample)"
_UNSAFE_FOLDER_CHARACTERS = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def default_books_directory() -> Path:
  """Where new books go unless the author chooses another folder."""
  override = os.environ.get("OPENAUTHOR_PROJECTS_DIR", "").strip()
  if override:
    return Path(override).expanduser()
  return Path.home() / "Documents" / "openAuthor"


def suggest_project_root(name: str) -> Path:
  """A folder for a new book: unused, readable, and named after its title."""
  folder = _UNSAFE_FOLDER_CHARACTERS.sub(" ", name)
  folder = re.sub(r"\s+", " ", folder).strip(" .")[:80].strip(" .") or "Untitled Novel"
  base = default_books_directory()
  candidate = base / folder
  number = 2
  # An existing empty folder is fine to reuse; anything else gets a new name.
  while candidate.exists() and (not candidate.is_dir() or any(candidate.iterdir())):
    candidate = base / f"{folder} {number}"
    number += 1
  return candidate


_SCENES: list[dict[str, str]] = [
  {
    "title": "The Clock Runs Ahead",
    "pov": "Wren",
    "summary": "Wren finds the tide clock four minutes fast; Odile orders it reset before the inspection.",
    "body": (
      "The tide clock in the harbour office had never been wrong, which was why Wren checked it three "
      "times before she believed it.\n\n"
      "Four minutes fast. The brass hand that marked high water stood past the hour, and the weights "
      "hung exactly where she had left them at dusk. She set her lamp on the bench and listened. The "
      "escapement ticked as evenly as breathing.\n\n"
      "“Well?” Odile Marsh filled the doorway in her oilskin, harbourmaster’s ledger under one arm. "
      "Odile had lost the ring finger on her right hand in childhood, and she tapped the gap against "
      "the ledger when she was impatient. She was tapping now.\n\n"
      "“It’s running ahead,” Wren said.\n\n"
      "“Then run it back. The council inspects at noon, and I will not show them a clock that lies.”\n\n"
      "Wren looked at the hand again. Old Tobias had built this clock to follow the sea, not the hour. "
      "In eleven years it had never needed running back."
    ),
  },
  {
    "title": "The Early Tide",
    "pov": "Wren",
    "summary": "At the tide steps Wren learns the clock is right: the sea itself is arriving early.",
    "body": (
      "She did not run it back. She went down to the tide steps instead, which was a thing she did "
      "sometimes when she wanted to think, and she counted the steps as she went because counting "
      "steadied her. There were thirty-one steps cut into the harbour wall, and each one was "
      "numbered in white paint that Tobias had renewed every spring.\n\n"
      "At this hour the water should have stood at the nineteenth step. It was lapping the twenty-third.\n\n"
      "Wren crouched and put her hand flat on the wet stone. Cold came up through her palm. A line of "
      "weed marked where yesterday’s tide had stopped, a full step lower.\n\n"
      "The clock was not fast. The sea was early.\n\n"
      "She thought of the grain barges moored along the low quay, loaded to the rail for morning, and "
      "of the forty families who lived below the nineteenth step because the clock had always told "
      "them it was safe."
    ),
  },
  {
    "title": "What Odile Knew",
    "pov": "Wren",
    "summary": "Wren confronts Odile, who admits the council already suspects and wants it kept quiet.",
    "body": (
      "Odile was on the signal gallery when Wren found her, watching the barges through a glass.\n\n"
      "“Twenty-third step,” Wren said. “An hour before it should be.”\n\n"
      "Five fingers on Odile’s right hand closed around the rail. She did not lower the glass. "
      "“You were told to reset the clock.”\n\n"
      "“The clock is right.”\n\n"
      "“I know it is right.” Now she turned. “I have known for nine days. So has the council. "
      "What do you imagine happens to this harbour, to the barge contracts, to every loan written "
      "against a warehouse on the low quay, when Saltmere learns its tide can no longer be told?”\n\n"
      "“The same thing that happens if nobody tells them,” Wren said. “Only wetter.”\n\n"
      "Below them the first barge swung on its mooring, and the rope sang as it took the strain."
    ),
  },
  {
    "title": "The Bell",
    "pov": "Wren",
    "summary": "Wren rings the flood bell herself, choosing the town over her post.",
    "body": (
      "The flood bell hung in its own small tower at the end of the office roof, and its rope was "
      "sealed with the harbourmaster’s wax. Tobias had shown her the seal on her first day. *Nobody "
      "rings that but Odile*, he had said, *and Odile never has.*\n\n"
      "Wren broke the wax with her thumbnail.\n\n"
      "The first stroke was louder than she expected. It went out over the low quay and came back "
      "off the warehouses, and somewhere below a shutter banged open. She rang again. Lamps were "
      "lit along the nineteenth step, then the eighteenth, a line of them climbing.\n\n"
      "She would not have a post in the morning. She found she had already stopped counting it as "
      "a loss.\n\n"
      "The tide clock, four minutes ahead of the hour, struck high water behind her, and for the "
      "first time in her life Wren did not turn to check it."
    ),
  },
]

_TIGHTENED_SECOND_SCENE_OPENING = (
  "She did not run it back. She went down to the tide steps instead, counting as she went because "
  "counting steadied her. Thirty-one steps were cut into the harbour wall, each numbered in white "
  "paint that Tobias had renewed every spring."
)


def create_sample_book(root: Path) -> ProjectPaths:
  """Create the sample book in an empty or missing folder and return its paths."""
  root = root.expanduser().resolve()
  if root.exists() and (not root.is_dir() or any(root.iterdir())):
    raise OpenAuthorError(f"Choose an empty folder for the sample book; {root} already has files in it.")
  root.mkdir(parents=True, exist_ok=True)

  from .codex import add_entity, ensure_codex
  from .planning import add_act, add_chapter, assign_scene, update_brief
  from .proposals import create_proposal, set_proposal_draft
  from .scenes import add_scene, parse_front_matter

  paths = initialize_project(root, name=SAMPLE_TITLE)
  ensure_codex(paths)

  scene_ids: list[str] = []
  for scene in _SCENES:
    scene_file = add_scene(paths, title=scene["title"], summary=scene["summary"], pov=scene["pov"], body=scene["body"])
    scene_ids.append(parse_front_matter(scene_file)["id"])

  update_brief(
    paths,
    synopsis=(
      "In the port of Saltmere an apprentice clockmaker discovers that the town’s tide clock is "
      "not wrong: the sea has started arriving early, and the harbourmaster would rather nobody knew."
    ),
    genre="Literary fantasy",
    themes=["Duty against obedience", "What a town owes the truth"],
    style_guide="Close third person on Wren, past tense. Plain, physical sentences; no adverbs doing a verb’s work.",
    outline=(
      "Things to try in this sample book:\n"
      "1. Open Changes and review the Change Set waiting on “The Early Tide”. Apply it, then undo it.\n"
      "2. Open Story Memory, choose Canon & Continuity and run the diagnostics. One detail about "
      "Odile’s hand contradicts itself between two scenes.\n"
      "3. Start a Storyline and try an ending where Wren does not ring the bell.\n"
      "Everything here is ordinary: edit it, break it, or delete the folder when you are done."
    ),
  )
  act = add_act(paths, title="High Water", synopsis="One night in which the clock, the sea and the town disagree.")
  first = add_chapter(paths, act_id=act["id"], title="The Clock", synopsis="Wren learns the clock is right.")
  second = add_chapter(paths, act_id=act["id"], title="The Bell", synopsis="Wren decides who needs to know.")
  for scene_id, chapter in zip(scene_ids, [first, first, second, second]):
    assign_scene(paths, scene_id=scene_id, chapter_id=chapter["id"])

  add_entity(paths, kind="character", name="Wren Halloway", aliases=["Wren"],
    description="Apprentice keeper of the Saltmere tide clock. Counts things when she needs to think. Trained by Tobias.")
  add_entity(paths, kind="character", name="Odile Marsh", aliases=["Odile"],
    description="Harbourmaster of Saltmere. Answers to the council and keeps the seal on the flood bell.")
  add_entity(paths, kind="character", name="Tobias", aliases=["Old Tobias"],
    description="The clockmaker who built the tide clock to follow the sea rather than the hour. No longer at the office.")
  add_entity(paths, kind="location", name="Saltmere",
    description="A harbour town. Forty families live below the nineteenth tide step because the clock says it is safe.")

  original = _SCENES[1]["body"]
  opening, separator, remainder = original.partition("\n\n")
  proposal_id = create_proposal(
    paths,
    title="The Early Tide: tighten the opening paragraph",
    instruction=(
      "Intent:\n- Reach the tide steps sooner; the reader already knows Wren is thinking.\n\n"
      "Constraints:\n- Keep the thirty-one steps, the white paint and Tobias.\n- Change nothing after the first paragraph.\n\n"
      "Edit Plan:\n- Cut “which was a thing she did sometimes when she wanted to think”.\n"
      "- Fold the step count into one sentence.\n\n"
      "Continuity Notes:\n- The nineteenth and twenty-third steps are referred to later and are untouched."
    ),
    scene_id=scene_ids[1],
    source="sample",
  )
  set_proposal_draft(paths, proposal_id=proposal_id, proposed_body=_TIGHTENED_SECOND_SCENE_OPENING + separator + remainder)
  # History starts with the book as delivered, so the first edit has something to be compared with.
  from .revisions import create_revision
  create_revision(paths, "Sample book created", kind="manual")
  return paths


def sample_book_summary(paths: ProjectPaths) -> dict[str, Any]:
  row = inspect_project(paths)
  row["initialized"] = True
  row["sample"] = True
  row["import_summary"] = None
  return row
