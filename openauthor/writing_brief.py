"""Assemble writing direction from reviewed sources without making another bible."""
from __future__ import annotations

from typing import Any

from .planning import get_plan, list_manuscript_scenes
from .project import ProjectPaths
from .scenes import get_scene
from .writing_craft import validate_scene_contract

WRITING_BRIEF_GUIDANCE = (
  "Use writing_brief as the author's scene direction and creative permissions. "
  "It governs planning, drafting and review. A generated edit plan, generic craft "
  "advice or stylistic preference cannot widen these permissions. "
  "Preserve mode allows changes to expression, not events, facts, motives, knowledge, "
  "relationships, agreements or the ending. Details mode also allows local sensory "
  "and staging details consistent with the supplied direction; it does not authorize "
  "new promises, consequential actions, history or revelations. Story mode allows "
  "only the developments described in allowed_changes. Protected elements and "
  "reveal_limits still govern in every mode. Character goals describe the speakers' "
  "tactics; knowledge and reveal limits describe this point in the story, not "
  "everything known to the author. Earlier prose is continuity evidence, not an "
  "approved voice exemplar. Voice excerpts are craft evidence, not new story facts. "
  "If direction conflicts with a protected source, flag the conflict in the edit "
  "plan rather than resolving it by inventing a fact. Candidates and proposed "
  "developments remain suggestions until the author accepts them."
)


def scene_writing_direction(paths: ProjectPaths, scene_id: str, overrides: Any = None, *, use_saved: bool = True) -> dict[str, Any]:
  metadata = get_plan(paths, persist=False).get("scene_metadata", {}).get(scene_id, {})
  saved = validate_scene_contract(metadata.get("writing_brief", {})) if use_saved else {}
  override = validate_scene_contract(overrides, partial=True)
  return validate_scene_contract({**saved, **override})


def assemble_writing_brief(paths: ProjectPaths, context: dict[str, Any], *,
                           scene_contract: Any = None, use_saved: bool = True, include_preceding: bool = True) -> str:
  """Consume permitted context; add only the saved scene direction and prior prose.

  A planned Change Set freezes its effective contract. Book sources remain current
  and are protected by the existing context fingerprint before and after delivery.
  """
  scene = context["scene"]
  metadata = get_plan(paths, persist=False).get("scene_metadata", {}).get(scene["id"], {})
  contract = scene_writing_direction(paths, scene["id"], scene_contract, use_saved=use_saved)
  context["scene_contract"] = contract
  has_source = str(context.get("current_candidate", context.get("selection", scene.get("body", "")))).strip() or context.get("review_sources")
  permission = contract.get("change_permission", "preserve" if has_source else "details")
  warnings = []
  if not scene.get("pov"):
    warnings.append("No viewpoint character is saved for this scene. Specify viewpoint in your direction.")
  voice = context.get("writing_voice", {})
  if not voice.get("observations"):
    warnings.append("No approved voice excerpts are included. Style traits alone do not establish your prose voice.")
  if not contract.get("knowledge"):
    warnings.append("Character knowledge at this story time has not been specified in the brief.")
  if not contract.get("reveal_limits"):
    warnings.append("Reveal limits have not been specified in the brief.")
  # Drafting previously lost the neighboring prose used in the edit-plan stage.
  # Only earlier scenes qualify; the bounded tail carries the immediate handoff.
  preceding = []
  if include_preceding and "nearby_scenes" not in context:
    rows = list_manuscript_scenes(paths)
    index = next((index for index, row in enumerate(rows) if row["id"] == scene["id"]), 0)
    for row in reversed(rows[:index]):
      previous = get_scene(paths, row["id"])
      if previous["body"].strip():
        body = previous["body"]
        preceding.append({"id": previous["id"], "title": previous["title"], "pov": previous["pov"],
                          "body": body[-6000:], "omitted_characters": max(0, len(body) - 6000)})
        break
    context["preceding_prose"] = preceding
  context["writing_brief"] = {
    "schema_version": 1, "scene_id": scene["id"], "pov": scene.get("pov", ""),
    "story_time": metadata.get("timeline_position", ""), "scene_summary": scene.get("summary", ""),
    "direction": contract, "change_permission": permission,
    "source_status": {"voice_excerpts": len(voice.get("observations", [])),
                      "memory_entries": len(context.get("codex_entities", context.get("memory", []))),
                      "approved_canon": len(context.get("review_context", {}).get("accepted_canon", []))},
    "warnings": warnings,
  }
  return "\n\nWriting brief policy:\n" + WRITING_BRIEF_GUIDANCE
