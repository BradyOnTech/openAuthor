"""Author-approved voice discovery, bounded prose previews and review handoff."""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now
from .project_locks import project_lock, serialized_project_access
from .scene_edits import workspace_edit_scope
from .scenes import get_scene
from .style_profile import DIMENSIONS, PRESETS, QUALITY_CRITERIA, VOICE_GUIDANCE, get_style_profile, validate_profile, voice_context


@serialized_project_access
def voice_workspace(paths: ProjectPaths) -> dict[str, Any]:
  scope = workspace_edit_scope(paths)[0]
  previews = []
  for path in sorted((paths.workspace_dir / "voice-previews").glob("*.json"), key=lambda row: row.stat().st_mtime, reverse=True):
    try:
      record = _read_preview(paths, path.stem)
      if record["scene_version"]["workspace"] == scope:
        previews.append(record)
    except (OpenAuthorError, KeyError, TypeError):
      continue
    if len(previews) == 5:
      break
  return {"profile": get_style_profile(paths), "scope": scope,
          "presets": PRESETS, "dimensions": DIMENSIONS, "criteria": QUALITY_CRITERIA, "previews": previews}


def _bounded(value: Any, name: str, limit: int) -> str:
  if not isinstance(value, str) or len(value) > limit:
    raise OpenAuthorError(f"{name} must be text of at most {limit} characters.")
  return value.strip()


def _model_json(paths: ProjectPaths, *, provider: str, model: str, task: str, payload: dict[str, Any]) -> dict[str, Any]:
  from .ai import complete_chat
  result = complete_chat(
    paths, provider=provider, model=model, system_prompt=VOICE_GUIDANCE + "\n" + task,
    user_prompt=json.dumps(payload, ensure_ascii=False), temperature=0.4, max_output_tokens=2600,
    input_token_ceiling=16000, response_token_reserve=2600,
  )
  raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", result["text"].strip())
  try:
    data = json.loads(raw)
  except ValueError as error:
    raise OpenAuthorError("The provider did not return a usable Writing Voice result. Nothing was applied; retry or edit the profile manually.") from error
  if not isinstance(data, dict):
    raise OpenAuthorError("The provider returned an invalid Writing Voice result.")
  return {"data": data, "generation_id": result["generation_id"]}


def prose_measures(text: str) -> dict[str, Any]:
  words = re.findall(r"\b[\w’'-]+\b", text)
  sentences = [row for row in re.split(r"(?<=[.!?])\s+", text) if row.strip()]
  dialogue = re.findall(r'[“"]([^”"]+)[”"]', text)
  return {"words": len(words), "average_sentence_words": round(len(words) / max(1, len(sentences)), 1),
          "dialogue_passages": len(dialogue), "paragraphs": len([p for p in text.split("\n\n") if p.strip()])}


def suggest_voice(paths: ProjectPaths, *, request: dict[str, Any]) -> dict[str, Any]:
  brief = _bounded(request.get("brief", ""), "Voice brief", 4000)
  selected = request.get("scene_ids", [])
  if not isinstance(selected, list) or len(selected) > 6 or any(not isinstance(value, str) for value in selected):
    raise OpenAuthorError("Choose up to six exemplar scenes.")
  if not brief and not selected:
    raise OpenAuthorError("Describe your intended voice or choose exemplar scenes first.")
  with project_lock(paths):
    workspace = voice_workspace(paths)
    profile = validate_profile(request.get("profile", workspace["profile"] or {}))
    scenes = [get_scene(paths, scene_id) for scene_id in dict.fromkeys(selected)]
    if any(not scene["body"].strip() for scene in scenes) or sum(len(scene["body"]) for scene in scenes) > 36000:
      raise OpenAuthorError("Choose nonempty exemplar scenes totaling at most 36,000 characters; no source passage was silently clipped.")
  provider = request.get("provider", "local")
  generation_id = ""
  if provider == "local":
    # Local mode is an explicit measurement aid, not a literary inference model.
    if len(brief) > 2400:
      raise OpenAuthorError("Local mode can retain a brief of up to 2,400 characters. Shorten it or choose an AI provider to interpret it.")
    if brief:
      profile["description"] = brief
    observations = []
    for scene in scenes:
      measurements = prose_measures(scene["body"])
      excerpt = scene["body"].strip()[:500]
      observations.append({"scene_id": scene["id"], "aspect": "Rhythm and dialogue",
        "observation": f"Measured {measurements['average_sentence_words']} words per sentence and {measurements['dialogue_passages']} quoted passages. Interpret voice, subtext and emotional effect yourself.", "excerpt": excerpt})
    message = "Local analysis measures rhythm and dialogue only. Use an AI provider for interpretation of imagery, humor, narrative distance and emotional expression; all suggestions require your approval."
  else:
    reply = _model_json(paths, provider=provider, model=request.get("model", ""), task=(
      "Propose an editable manuscript Writing Voice from the author's brief and only their selected exemplars. "
      "Return JSON {profile:{name,description,traits,guidance,avoid},observations:[{scene_id,aspect,observation,excerpt}]}. "
      "Use only allowed trait values. Discuss narrative distance, humor, imagery, dialogue habits, emotional expression and rhythm where supported. "
      "Each observation must cite an exact nonempty excerpt (at most 600 characters) from a selected scene. "
      "State uncertainty; do not infer genre or character facts as style rules. No author imitation presets. Max 12 observations, 12 guidance lines and 12 avoid lines."
    ), payload={"brief": brief, "current_profile": voice_context(profile), "dimensions": DIMENSIONS,
                "exemplars": [{"scene_id": row["id"], "text": row["body"]} for row in scenes]})
    data = reply["data"]
    profile = validate_profile(data.get("profile"))
    observations = data.get("observations", [])
    generation_id = reply["generation_id"]
    message = "AI interpretation, not an objective literary assessment. Review the traits and verify every cited passage before saving."
  source_digests = {row["id"]: hashlib.sha256(row["body"].encode()).hexdigest() for row in scenes}
  profile.update({"exemplar_scene_ids": [row["id"] for row in scenes],
                  "exemplar_digests": source_digests, "source_digests": source_digests,
                  "observations": observations, "metrics": prose_measures("\n\n".join(row["body"] for row in scenes)) if scenes else {}})
  profile = validate_profile(profile)
  by_id = {row["id"]: row["body"] for row in scenes}
  if any(not row["excerpt"] or row["excerpt"] not in by_id[row["scene_id"]] for row in profile["observations"]):
    raise OpenAuthorError("The analysis included an unverifiable exemplar quotation. No profile was saved.")
  return {"profile": profile, "message": message, "generation_id": generation_id,
          "base_version": workspace["profile"]["version"] if workspace["profile"] else "", "scope": workspace["scope"]}


def _preview_path(paths: ProjectPaths, preview_id: str):
  if not re.fullmatch(r"voice-preview-[a-f0-9]{12}", preview_id):
    raise OpenAuthorError("Invalid Writing Voice preview id.")
  return paths.workspace_dir / "voice-previews" / f"{preview_id}.json"


def _read_preview(paths: ProjectPaths, preview_id: str) -> dict[str, Any]:
  try:
    record = json.loads(_preview_path(paths, preview_id).read_text(encoding="utf-8"))
  except (OSError, ValueError) as error:
    raise OpenAuthorError("Writing Voice preview is unavailable.") from error
  if not isinstance(record, dict) or record.get("id") != preview_id or record.get("schema_version") != 1 or not isinstance(record.get("directions"), list):
    raise OpenAuthorError("Writing Voice preview has invalid metadata.")
  return record


def preview_voice(paths: ProjectPaths, *, request: dict[str, Any]) -> dict[str, Any]:
  return _preview_voice(paths, request=request)


def refine_voice_preview(paths: ProjectPaths, *, request: dict[str, Any]) -> dict[str, Any]:
  feedback = _bounded(request.get("feedback", ""), "Revision feedback", 2000)
  if not feedback:
    raise OpenAuthorError("Describe what to keep or change in this sample before refining it.")
  with project_lock(paths):
    original = _read_preview(paths, request.get("preview_id", ""))
    direction = next((row for row in original["directions"] if row["id"] == request.get("direction_id")), None)
    if direction is None:
      raise OpenAuthorError("Unknown Writing Voice direction.")
  return _preview_voice(paths, request={
    "scene_id": original["scene_id"], "source_text": original["source_text"],
    "instruction": original["instruction"], "directions": [direction["profile"]],
    "provider": request.get("provider", "local"), "model": request.get("model", ""),
    "strict_review": request.get("strict_review", False),
  }, refinement={"preview_id": original["id"], "direction_id": direction["id"],
    "candidate": direction["text"], "feedback": feedback}, expected_scene_version=original["scene_version"])


def _preview_voice(paths: ProjectPaths, *, request: dict[str, Any], refinement: dict[str, Any] | None = None,
                   expected_scene_version: dict[str, Any] | None = None) -> dict[str, Any]:
  from .ai import build_generation_context
  source = _bounded(request.get("source_text", ""), "Preview excerpt", 6000)
  instruction = _bounded(request.get("instruction", "Explore the voice without changing events."), "Preview instruction", 2000)
  if not source or len(source.split()) > 400:
    raise OpenAuthorError("Select a nonempty passage of at most 400 words for short previews.")
  directions = request.get("directions", [])
  if not isinstance(directions, list) or len(directions) not in ({1} if refinement else {2, 3}):
    raise OpenAuthorError("Compare two or three Writing Voice directions.")
  profiles = [validate_profile(value) for value in directions]
  if len({json.dumps({key: value for key, value in voice_context(row).items() if key != "name"}, sort_keys=True) for row in profiles}) != len(profiles):
    raise OpenAuthorError("Choose distinct Writing Voice directions.")
  with project_lock(paths):
    scene = get_scene(paths, request.get("scene_id", ""))
    if expected_scene_version is not None and scene["edit_version"] != expected_scene_version:
      raise OpenAuthorError("The scene or Storyline changed after preview. Generate fresh previews; newer work was preserved.")
    if scene["body"].count(source) != 1:
      raise OpenAuthorError("The preview excerpt must match exactly one passage in the saved scene.")
    context = build_generation_context(paths, scene_id=scene["id"], context_scene_radius=0, codex_limit=8)
    # Previews supply only the selected prose, plus authored context and metadata.
    context["scene"] = {key: scene[key] for key in ("id", "title", "summary", "pov", "status")}
    context.pop("writing_voice", None)
  provider = request.get("provider", "local")
  strict_review = request.get("strict_review", False)
  if not isinstance(strict_review, bool):
    raise OpenAuthorError("strict_review must be true or false.")
  variants = []
  for index, profile in enumerate(profiles):
    observations = []
    if provider == "local":
      text = source
      warnings = ["Local mode preserves the source as a comparison baseline; it does not generate creative prose. Select an AI provider for actual voice variations."]
      generation_id = ""
    else:
      reply = _model_json(paths, provider=provider, model=request.get("model", ""), task=(
        "Rewrite only the supplied short source passage in the selected Writing Voice. Preserve events, names, facts, POV, tense and knowledge. "
        "Keep unfinished actions unfinished, uncertain beliefs uncertain, and withheld knowledge withheld. "
        "Preserve each speaker's individual habits and the scene's emotional turn; manuscript voice is not a reason to make everyone sound alike. "
        "Use concrete attention, choices and subtext where appropriate, without explaining every gesture or adding generic metaphors. "
        "Vary rhythm to serve this moment, not a uniform sentence length. Keep intentional repetitions and strong passages when rewriting would weaken them. "
        "End at the source passage's existing story beat: do not append dialogue, actions, discoveries or resolutions. "
        "Do not invent physical staging to justify a stylistic change. "
        "If refinement is supplied, use its candidate as a draft and its feedback to make a focused revision; the original source remains the authority for events and knowledge. "
        "Retain successful wording unless the feedback or selected voice calls for changing it. "
        "Return JSON {text:string,observations:[{criterion,observation,excerpt}]}. No more than 500 prose words. "
        "For each review criterion give a concrete self-review with an exact excerpt from your candidate; acknowledge uncertain continuity. "
        "These are observations for author judgment, never numerical quality scores."
      ), payload={"source": source, "instruction": instruction, "writing_voice": voice_context(profile), "context": context,
                  "criteria": QUALITY_CRITERIA, **({"refinement": refinement} if refinement else {})})
      text = _bounded(reply["data"].get("text"), "Preview prose", 8000)
      if not text or len(text.split()) > 500:
        raise OpenAuthorError("The provider exceeded the short-preview limit. Nothing was applied.")
      raw = reply["data"].get("observations", [])
      review_warnings = []
      review_error = ""
      if not isinstance(raw, list) or len(raw) > 10:
        review_error = "The provider returned an invalid prose assessment."
        review_warnings.append("Provider self-review was incomplete or invalid; review the generated prose yourself.")
      else:
        for row in raw:
          try:
            if not isinstance(row, dict) or row.get("criterion") not in QUALITY_CRITERIA:
              raise OpenAuthorError("The provider returned an unknown review criterion.")
            quote = _bounded(row.get("excerpt", ""), "Assessment excerpt", 600)
            # Providers sometimes wrap a citation in presentation quotes. Remove
            # exactly one matching pair only when the enclosed evidence is literal;
            # real dialogue quotes already present in the candidate stay intact.
            if quote and quote not in text:
              for opening, closing in [('“', '”'), ('"', '"'), ('‘', '’'), ("'", "'")]:
                if quote.startswith(opening) and quote.endswith(closing) and quote[1:-1] and quote[1:-1] in text:
                  quote = quote[1:-1]
                  break
            if not quote or quote not in text:
              raise OpenAuthorError("The provider's prose assessment quoted text absent from its candidate.")
            observations.append({"criterion": row["criterion"], "observation": _bounded(row.get("observation", ""), "Assessment", 600), "excerpt": quote})
          except OpenAuthorError as error:
            if not review_error:
              review_error = str(error)
            if not review_warnings:
              review_warnings.append("Provider self-review included incomplete or unverifiable evidence; affected observations were omitted. Review the generated prose yourself.")
      if strict_review and review_error:
        raise OpenAuthorError(review_error)
      warnings = ["Provider self-review is not independent validation. Check character voice and factual consistency yourself.", *review_warnings]
      generation_id = reply["generation_id"]
    variants.append({"id": f"direction-{index + 1}", "profile": profile, "text": text,
                     "observations": observations, "warnings": warnings, "generation_id": generation_id,
                     "measures": prose_measures(text), "author_review": {"ratings": {}, "notes": ""}})
  record = {"schema_version": 1, "id": f"voice-preview-{uuid.uuid4().hex[:12]}", "scene_id": scene["id"],
            "scene_version": scene["edit_version"], "source_text": source, "instruction": instruction,
            "provider": provider, "model": request.get("model", ""), "created_at": utc_now(), "directions": variants}
  if refinement:
    record["refinement"] = refinement
  with project_lock(paths):
    atomic_write_json(_preview_path(paths, record["id"]), record)
  return record


@serialized_project_access
def review_voice_preview(paths: ProjectPaths, *, preview_id: str, direction_id: str, review: dict[str, Any], expected_review: dict[str, Any] | None = None) -> dict[str, Any]:
  if not isinstance(review, dict):
    raise OpenAuthorError("Invalid author prose assessment.")
  record = _read_preview(paths, preview_id)
  if record["scene_version"]["workspace"] != workspace_edit_scope(paths)[0]:
    raise OpenAuthorError("This assessment belongs to another Storyline. Reopen its preview in the original Storyline.")
  direction = next((row for row in record["directions"] if row["id"] == direction_id), None)
  if direction is None:
    raise OpenAuthorError("Unknown Writing Voice direction.")
  if expected_review is not None and expected_review != direction["author_review"]:
    raise OpenAuthorError("This assessment was saved elsewhere. Your local draft was kept; reopen the preview and review the saved assessment before replacing it.")
  ratings = review.get("ratings", {})
  if not isinstance(ratings, dict) or set(ratings) - set(QUALITY_CRITERIA) or any(value not in {"unreviewed", "works", "needs_revision"} for value in ratings.values()):
    raise OpenAuthorError("Invalid author prose assessment.")
  direction["author_review"] = {"ratings": ratings, "notes": _bounded(review.get("notes", ""), "Review notes", 3000)}
  atomic_write_json(_preview_path(paths, preview_id), record)
  return record


@serialized_project_access
def stage_voice_preview(paths: ProjectPaths, *, preview_id: str, direction_id: str) -> dict[str, Any]:
  from .proposals import create_proposal, get_proposal, list_proposals, set_proposal_draft
  record = _read_preview(paths, preview_id)
  direction = next((row for row in record["directions"] if row["id"] == direction_id), None)
  if direction is None:
    raise OpenAuthorError("Unknown Writing Voice direction.")
  if direction.get("proposal_id"):
    return get_proposal(paths, direction["proposal_id"])
  # Recover a completed or interrupted handoff if recording its link failed.
  # Never rebuild a Change Set that the author has already reviewed or edited.
  previous = next((row for row in list_proposals(paths)
    if row.get("source") == "writing_voice_preview"
    and row.get("generation", {}).get("preview_id") == preview_id
    and row.get("generation", {}).get("direction_id") == direction_id), None)
  if previous and (previous.get("change_set") or previous.get("proposed_body") or previous["status"] != "pending"):
    direction["proposal_id"] = previous["id"]
    atomic_write_json(_preview_path(paths, preview_id), record)
    return previous
  scene = get_scene(paths, record["scene_id"])
  if scene["edit_version"] != record["scene_version"]:
    raise OpenAuthorError("The scene or Storyline changed after preview. Generate fresh previews; newer work was preserved.")
  if direction["text"] == record["source_text"]:
    raise OpenAuthorError("This baseline contains no prose change to send for review.")
  if scene["body"].count(record["source_text"]) != 1:
    raise OpenAuthorError("The preview passage no longer matches one scene location.")
  proposal_id = previous["id"] if previous else create_proposal(paths, title=f"Voice preview: {direction['profile']['name']}", scene_id=scene["id"],
    instruction=record["instruction"] + ("\nAuthor revision feedback: " + record["refinement"]["feedback"] if record.get("refinement") else "")
      + "\nWriting Voice: " + json.dumps(voice_context(direction["profile"])),
    source="writing_voice_preview", generation={"provider": record["provider"], "model": record["model"], "preview_id": preview_id, "direction_id": direction_id})
  result = set_proposal_draft(paths, proposal_id=proposal_id,
    proposed_body=scene["body"].replace(record["source_text"], direction["text"], 1))
  direction["proposal_id"] = proposal_id
  atomic_write_json(_preview_path(paths, preview_id), record)
  return result
