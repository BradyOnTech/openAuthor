"""Bundled fiction craft, selected by task rather than inherited agent settings.

No book files are read here. Callers supply only their already reviewed story
context, so craft guidance cannot widen Memory permissions or invent canon.
"""
from __future__ import annotations

import hashlib
from importlib.resources import files
from typing import Any

from .project import OpenAuthorError

SKILL_VERSION = "1.2.4"
TASKS = {"plan", "draft", "rewrite", "shorten", "expand", "critique", "refine"}
CONTRACT_FIELDS = {"purpose", "turn", "ending", "word_range", "editable_scope"}
DRAFT_REVISION_FOCUSES = {"", "dialogue", "motivation", "pov", "pacing", "setup-payoff", "prose clarity"}
_FOCUSES = {
  "dialogue": "dialogue", "character motivation": "scene", "motivation": "scene",
  "pov integrity": "viewpoint", "pov": "viewpoint", "character-knowledge": "viewpoint",
  "continuity": "viewpoint", "pacing": "pacing", "tension": "pacing",
  "setup & payoff": "setup-payoff", "setup-payoff": "setup-payoff",
  "prose clarity": "prose", "voice": "prose",
}


def validate_scene_contract(value: Any = None) -> dict[str, Any]:
  """Retain authored intent literally; unknown fields and clipping are errors."""
  if value is None:
    return {}
  if not isinstance(value, dict) or set(value) - CONTRACT_FIELDS:
    raise OpenAuthorError("Scene intent must contain purpose, turn, ending text, a word range or editable scope.")
  result = {}
  for key, text in value.items():
    if key == "editable_scope":
      if text != "quoted_text":
        raise OpenAuthorError("Editable scope must be quoted_text, or omitted for whole-scene editing.")
      result[key] = text
      continue
    if key == "word_range":
      if not isinstance(text, list) or len(text) != 2 or any(type(item) is not int for item in text) or not 1 <= text[0] <= text[1] <= 20000:
        raise OpenAuthorError("A scene word range needs two whole numbers, 1–20,000, in ascending order.")
      result[key] = list(text)
      continue
    if not isinstance(text, str) or len(text) > 1200:
      raise OpenAuthorError(f"Scene intent {key} must be text of at most 1,200 characters.")
    if text.strip():
      result[key] = text.strip()
  if sum(len(text) for text in result.values() if isinstance(text, str)) > 3000:
    raise OpenAuthorError("Scene intent exceeds 3,000 characters; shorten it before generating.")
  return result


def writing_craft(task: str, *, direction: str = "", focus: str = "") -> dict[str, Any]:
  """Return task guidance and a receipt of exactly which resources supplied it.

  The host chooses the task. An explicit Editorial Pass selects its reference;
  free-form requests keep the general scene/prose guidance. Resource content is
  hashed every time so an updated kit invalidates previously reviewed requests.
  """
  if task not in TASKS:
    raise OpenAuthorError("Choose a supported writing task.")
  selected = ["integrity"]
  if task == "plan":
    selected.append("scene")
  elif task == "critique":
    selected.append("review")
  else:
    selected.append("prose")
  if task in {"draft", "expand"}:
    selected.append("scene")
  if task == "refine":
    selected.append("review")
  target = _FOCUSES.get(focus.casefold())
  if not target:
    lowered = direction.casefold()
    target = next((reference for name, reference in _FOCUSES.items()
      if f"[editorial pass: {name}]" in lowered), None)
  if target and target not in selected:
    selected.append(target)
  root = files("openauthor").joinpath("writing_skills", "fiction-writing")
  resource_ids = ["SKILL.md", *[f"references/{name}.md" for name in selected]]
  texts = [root.joinpath(name).read_text(encoding="utf-8") for name in resource_ids]
  # Metadata is for installed agents; host requests contain only instructions.
  entry = texts[0].split("---", 2)[-1].strip()
  guidance = "\n\n".join([f"Writing task: {task}.\n" + entry, *texts[1:]])
  digest = hashlib.sha256("\0".join(f"{name}\0{text}" for name, text in zip(resource_ids, texts)).encode()).hexdigest()
  return {"manifest": {"schema_version": 1, "name": "fiction-writing", "version": SKILL_VERSION,
                       "task": task, "resources": resource_ids, "sha256": digest},
          "instructions": guidance}


def attach_writing_craft(context: dict[str, Any], *, task: str, direction: str = "",
                         focus: str = "", scene_contract: Any = None) -> str:
  """Attach the inspectable receipt/intent and return instructions for the host."""
  craft = writing_craft(task, direction=direction, focus=focus)
  context["writing_craft"] = craft["manifest"]
  if scene_contract is not None:
    context["scene_contract"] = validate_scene_contract(scene_contract)
  return "\n\nFiction craft guidance:\n" + craft["instructions"]
