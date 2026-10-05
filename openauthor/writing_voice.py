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
from .revision_preservation import (PRESERVATION_FIELDS, check_expected_preservation, missing_protected_wording,
  preservation_fingerprint, validate_preservation)
from .scenes import get_scene
from .writing_craft import attach_writing_craft
from .style_profile import DIMENSIONS, PRESETS, QUALITY_CRITERIA, VOICE_GUIDANCE, get_style_profile, validate_profile, voice_context, voice_evidence_context


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
                  "use_exemplar_evidence": False,
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
  binding_path = _preservation_binding_path(paths, preview_id)
  if binding_path.exists() or PRESERVATION_FIELDS.intersection(record):
    try:
      binding = json.loads(binding_path.read_text(encoding="utf-8"))
      if (not isinstance(binding, dict) or set(binding) != {"schema_version", "preview_id", "preservation_fingerprint"}
          or type(binding["schema_version"]) is not int or binding["schema_version"] != 1 or binding["preview_id"] != preview_id
          or not PRESERVATION_FIELDS.issubset(record) or type(record["preservation_schema_version"]) is not int or record["preservation_schema_version"] != 1):
        raise ValueError("Invalid preservation metadata")
      clauses = validate_preservation(record["preservation"], source=record["source_text"])
      fingerprint = preservation_fingerprint(record, clauses)
      if fingerprint != record["preservation_fingerprint"] or fingerprint != binding["preservation_fingerprint"]:
        raise ValueError("Preservation contract changed")
    except (OSError, ValueError, TypeError, KeyError, OpenAuthorError) as error:
      raise OpenAuthorError("Writing Voice preservation metadata changed or is incomplete. The candidate was kept; reopen a valid preview or generate a fresh comparison.") from error
  return record


def _preservation_binding_path(paths: ProjectPaths, preview_id: str):
  _preview_path(paths, preview_id)
  return paths.workspace_dir / "voice-preservation" / f"{preview_id}.json"


def _save_new_preview(paths: ProjectPaths, record: dict[str, Any]) -> None:
  # Call under the project lock. The immutable local binding precedes the preview:
  # interruption can leave an orphan binding, never a preview silently downgraded
  # to legacy. This is recovery metadata, not integrity against editing both files.
  path = _preview_path(paths, record["id"])
  binding = _preservation_binding_path(paths, record["id"])
  if path.exists() or binding.exists():
    raise OpenAuthorError("Writing Voice preview identity already exists. The earlier comparison was preserved; generate a fresh comparison.")
  atomic_write_json(binding, {"schema_version": 1, "preview_id": record["id"], "preservation_fingerprint": record["preservation_fingerprint"]})
  atomic_write_json(path, record)


def _literal_assessment_excerpt(value: Any, *, text: str, name: str) -> str:
  quote = _bounded(value, name, 600)
  if quote and quote not in text:
    for opening, closing in [('“', '”'), ('"', '"'), ('‘', '’'), ("'", "'")]:
      if quote.startswith(opening) and quote.endswith(closing) and quote[1:-1] and quote[1:-1] in text:
        quote = quote[1:-1]
        break
  if not quote or quote not in text:
    raise OpenAuthorError(f"The provider's prose assessment quoted text absent from its {name.lower()}.")
  return quote


def preview_voice(paths: ProjectPaths, *, request: dict[str, Any]) -> dict[str, Any]:
  return _preview_voice(paths, request=request)


def refine_voice_preview(paths: ProjectPaths, *, request: dict[str, Any]) -> dict[str, Any]:
  feedback = _bounded(request.get("feedback", ""), "Revision feedback", 2000)
  if not feedback:
    raise OpenAuthorError("Describe what to keep or change in this sample before refining it.")
  with project_lock(paths):
    original = _read_preview(paths, request.get("preview_id", ""))
    if "expected_preservation_fingerprint" in request:
      check_expected_preservation(original, request["expected_preservation_fingerprint"])
    if "preservation" in request and validate_preservation(request["preservation"], source=original["source_text"]) != original.get("preservation", []):
      raise OpenAuthorError("Refinement must keep the original preservation contract. Start a fresh comparison to change author constraints.")
    direction = next((row for row in original["directions"] if row["id"] == request.get("direction_id")), None)
    if direction is None:
      raise OpenAuthorError("Unknown Writing Voice direction.")
  return _preview_voice(paths, request={
    "scene_id": original["scene_id"], "source_text": original["source_text"],
    "instruction": original["instruction"], "directions": [direction["profile"]],
    "provider": request.get("provider", "local"), "model": request.get("model", ""),
    "strict_review": request.get("strict_review", False),
    "preservation": original.get("preservation", []),
  }, refinement={"preview_id": original["id"], "direction_id": direction["id"],
    "candidate": direction["text"], "feedback": feedback}, expected_scene_version=original["scene_version"])


def _preview_voice(paths: ProjectPaths, *, request: dict[str, Any], refinement: dict[str, Any] | None = None,
                   expected_scene_version: dict[str, Any] | None = None) -> dict[str, Any]:
  from .ai import build_generation_context
  source = _bounded(request.get("source_text", ""), "Preview excerpt", 6000)
  instruction = _bounded(request.get("instruction", "Explore the voice without changing events."), "Preview instruction", 2000)
  if not source or len(source.split()) > 400:
    raise OpenAuthorError("Select a nonempty passage of at most 400 words for short previews.")
  preservation = validate_preservation(request.get("preservation", []), source=source)
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
  craft = attach_writing_craft(context, task="refine" if refinement else "rewrite", direction=instruction)
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
        "Follow every explicit author preservation constraint unchanged. Keep each uncertainty's original subject, domain and degree; do not broaden it to other people or events. "
        "The selected original passage and explicit preservation constraints govern this revision; background context constrains consistency, not new material to insert. "
        "Preserve protected_text literally. If a constraint cannot be met, state the limitation in self-review; do not silently replace it with a different interpretation. "
        "Preserve each speaker's individual habits and the scene's emotional turn; manuscript voice is not a reason to make everyone sound alike. "
        "Use concrete attention, choices and subtext where appropriate, without explaining every gesture or adding generic metaphors. "
        "Vary rhythm to serve this moment, not a uniform sentence length. Keep intentional repetitions and strong passages when rewriting would weaken them. "
        "End at the source passage's existing story beat: do not append dialogue, actions, discoveries or resolutions. "
        "Do not invent physical staging to justify a stylistic change. "
        "If refinement is supplied, use its candidate as a draft and its feedback to make a focused revision; the original source remains the authority for events and knowledge. "
        "Retain successful wording unless the feedback or selected voice calls for changing it. "
        "Return JSON {text:string,observations:[{criterion,observation,excerpt,source_excerpt}]}. No more than 500 prose words. "
        "For each review criterion give a concrete self-review with an exact excerpt from your candidate; acknowledge uncertain continuity. "
        "For consistency observations also cite an exact nonempty source_excerpt from the selected original, pairing it with the candidate excerpt so the author can compare meaning. "
        "These are observations for author judgment, never numerical quality scores." + craft
      ), payload={"source": source, "instruction": instruction, "preservation": preservation, "writing_voice": voice_evidence_context(profile), "context": context,
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
            quote = _literal_assessment_excerpt(row.get("excerpt", ""), text=text, name="Candidate")
            observation = {"criterion": row["criterion"], "observation": _bounded(row.get("observation", ""), "Assessment", 600), "excerpt": quote}
            if row["criterion"] == "consistency" or "source_excerpt" in row:
              observation["source_excerpt"] = _literal_assessment_excerpt(row.get("source_excerpt", ""), text=source, name="Source")
            observations.append(observation)
          except OpenAuthorError as error:
            if not review_error:
              review_error = str(error)
            if not review_warnings:
              review_warnings.append("Provider self-review included incomplete or unverifiable evidence; affected observations were omitted. Review the generated prose yourself.")
      if strict_review and review_error:
        raise OpenAuthorError(review_error)
      warnings = ["Provider self-review is not independent semantic validation. Literal quotations show where to compare; judge character knowledge, facts and uncertainty yourself.", *review_warnings]
      generation_id = reply["generation_id"]
    for wording in missing_protected_wording(preservation, text):
      warnings.append("Missing protected wording: " + json.dumps(wording, ensure_ascii=False) + ". Refine this candidate to restore the exact wording before sending it for review.")
    variants.append({"id": f"direction-{index + 1}", "profile": profile, "text": text,
                     "observations": observations, "warnings": warnings, "generation_id": generation_id,
                     "measures": prose_measures(text), "author_review": {"ratings": {}, "notes": ""}})
  record = {"schema_version": 1, "id": f"voice-preview-{uuid.uuid4().hex[:12]}", "scene_id": scene["id"],
            "scene_version": scene["edit_version"], "source_text": source, "instruction": instruction,
            "provider": provider, "model": request.get("model", ""), "created_at": utc_now(), "directions": variants,
            "writing_craft": context["writing_craft"]}
  if refinement:
    record["refinement"] = refinement
  record.update({"preservation": preservation, "preservation_schema_version": 1,
    "preservation_fingerprint": preservation_fingerprint(record, preservation)})
  with project_lock(paths):
    _save_new_preview(paths, record)
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
def stage_voice_preview(paths: ProjectPaths, *, preview_id: str, direction_id: str, expected_preservation_fingerprint: str | None = None) -> dict[str, Any]:
  from .proposals import create_proposal, get_proposal, list_proposals, set_proposal_draft
  record = _read_preview(paths, preview_id)
  if expected_preservation_fingerprint is not None:
    check_expected_preservation(record, expected_preservation_fingerprint)
  direction = next((row for row in record["directions"] if row["id"] == direction_id), None)
  if direction is None:
    raise OpenAuthorError("Unknown Writing Voice direction.")
  missing = missing_protected_wording(record.get("preservation", []), direction["text"])
  if missing:
    raise OpenAuthorError("Restore the exact protected wording before sending this candidate for review: " + json.dumps(missing, ensure_ascii=False))
  def checked_handoff(proposal: dict[str, Any]) -> dict[str, Any]:
    if any(proposal.get("generation", {}).get(key) != record[key] for key in PRESERVATION_FIELDS if key in record):
      raise OpenAuthorError("The staged proposal's preservation provenance changed or is incomplete. Review the existing proposal; it was not replaced.")
    return proposal
  if direction.get("proposal_id"):
    return checked_handoff(get_proposal(paths, direction["proposal_id"]))
  # Recover a completed or interrupted handoff if recording its link failed.
  # Never rebuild a Change Set that the author has already reviewed or edited.
  previous = next((row for row in list_proposals(paths)
    if row.get("source") == "writing_voice_preview"
    and row.get("generation", {}).get("preview_id") == preview_id
    and row.get("generation", {}).get("direction_id") == direction_id), None)
  if previous:
    checked_handoff(previous)
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
      + "\nWriting Voice: " + json.dumps(voice_evidence_context(direction["profile"]))
      + ("\nAuthor preservation constraints (exact wording): " + json.dumps(record["preservation"], ensure_ascii=False) if record.get("preservation") else ""),
    source="writing_voice_preview", generation={"provider": record["provider"], "model": record["model"], "preview_id": preview_id, "direction_id": direction_id,
      "source_text": record["source_text"], "source_scene_version": record["scene_version"], "voice_observations": direction["observations"],
      **{key: record[key] for key in PRESERVATION_FIELDS if key in record}})
  result = set_proposal_draft(paths, proposal_id=proposal_id,
    proposed_body=scene["body"].replace(record["source_text"], direction["text"], 1))
  direction["proposal_id"] = proposal_id
  atomic_write_json(_preview_path(paths, preview_id), record)
  return result
