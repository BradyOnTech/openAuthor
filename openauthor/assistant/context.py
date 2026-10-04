"""Deterministic, budgeted context selection for every Assistant channel."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Sequence

from ..ai_visibility import memory_for_ai
from ..story_context import story_plan_for_ai
from ..story_grounding import prepare_story_grounding
from ..checks import run_continuity_checks
from ..codex import list_entities
from ..memory_context import get_assistant_memory, memory_for_assistant, memory_access_stamp
from ..project import (
  OpenAuthorError,
  ProjectPaths,
  atomic_write_json,
  ensure_project_identity,
  utc_now,
)
from ..retrieval import query_retrieval_index
from ..revisions import revision_head
from ..scenes import get_scene
from ..project_locks import serialized_project_access
from ..planning import get_plan, list_manuscript_scenes
from ..review_context import build_review_context
from ..model_input import TOKEN_ESTIMATOR_VERSION, estimate_tokens
from .budget import BudgetCandidate, BudgetPolicy, allocate_input_budget
from .prompts import build_model_input, estimate_model_input, response_token_limit


CONTEXT_PACK_SCHEMA_VERSION = 1
ASSISTANT_CHANNELS = {"text", "desktop_voice", "mobile_voice"}
CONTEXT_SCOPES = {"adaptive", "project", "scene", "chapter", "character", "storyline"}


@dataclass(frozen=True)
class ContextRequest:
  thread_id: str
  channel: str
  utterance: str
  scope: str = "adaptive"
  current_scene_id: str = ""
  selected_text: str = ""
  explicit_scene_ids: tuple[str, ...] = ()
  explicit_codex_ids: tuple[str, ...] = ()
  approved_codex_ids: tuple[str, ...] = ()
  memory_approvals: tuple[dict[str, str], ...] = ()
  story_approvals: tuple[str, ...] = ()
  history: tuple[Mapping[str, Any], ...] = ()
  agent_mode: bool = False
  bound_brief: bool = False


@dataclass(frozen=True)
class ContextPolicy:
  input_token_ceiling: int = 16_000
  response_token_reserve: int = 1_200
  include_current_scene: bool = True
  include_selection: bool = True
  nearby_scene_radius: int = 1
  include_codex: str = "auto_and_explicit"
  retrieval_mode: str = "auto"
  retrieval_limit: int = 5
  retrieval_min_score: float = 0.0
  retrieval_require_fresh: bool = False
  max_items: int = 64
  max_item_characters: int = 12_000

  def __post_init__(self) -> None:
    if self.input_token_ceiling < 1:
      raise ValueError("input_token_ceiling must be positive.")
    if self.response_token_reserve < 0:
      raise ValueError("response_token_reserve must be non-negative.")
    if self.nearby_scene_radius < 0:
      raise ValueError("nearby_scene_radius must be non-negative.")
    if self.include_codex not in {"off", "explicit", "auto", "auto_and_explicit"}:
      raise ValueError("Invalid include_codex policy.")
    if self.retrieval_mode not in {"off", "auto", "required"}:
      raise ValueError("Invalid retrieval_mode policy.")
    if self.max_items < 1 or self.max_item_characters < 4:
      raise ValueError("Context item bounds must be positive.")


@dataclass(frozen=True)
class ContextItem:
  id: str
  kind: str
  source_ref: str
  source_path: str
  source_title: str
  content: str
  content_digest: str
  estimated_tokens: int
  selection_reason: str
  priority: int
  authority: int
  retrieval_score: float | None = None
  score_breakdown: dict[str, float] = field(default_factory=dict)
  source_revision: str = ""
  citation: dict[str, Any] = field(default_factory=dict)
  preview_truncated: bool = False


@dataclass(frozen=True)
class ContextPack:
  schema_version: int
  pack_id: str
  project_id: str
  project_revision: str
  thread_id: str
  channel: str
  scope: str
  items: list[ContextItem]
  history: list[dict[str, Any]]
  prompt_brief: str
  resolved_references: list[dict[str, Any]]
  citations: list[dict[str, Any]]
  warnings: list[str]
  conflicts: list[dict[str, Any]]
  budget: dict[str, Any]
  freshness: dict[str, Any]
  degradations: list[dict[str, Any]]
  trace: list[dict[str, Any]]
  created_at: str
  provider_context: dict[str, Any]
  memory_access: dict[str, Any] = field(default_factory=dict)
  model_input: dict[str, Any] = field(default_factory=dict)

  def to_dict(self) -> dict[str, Any]:
    return asdict(self)

  @classmethod
  def from_dict(cls, payload: Mapping[str, Any]) -> "ContextPack":
    return cls(
      schema_version=int(payload["schema_version"]),
      pack_id=str(payload["pack_id"]),
      project_id=str(payload["project_id"]),
      project_revision=str(payload["project_revision"]),
      thread_id=str(payload["thread_id"]),
      channel=str(payload["channel"]),
      scope=str(payload["scope"]),
      items=[ContextItem(**dict(item)) for item in payload.get("items", [])],
      history=[dict(item) for item in payload.get("history", [])],
      prompt_brief=str(payload.get("prompt_brief", "")),
      resolved_references=[dict(item) for item in payload.get("resolved_references", [])],
      citations=[dict(item) for item in payload.get("citations", [])],
      warnings=[str(item) for item in payload.get("warnings", [])],
      conflicts=[dict(item) for item in payload.get("conflicts", [])],
      budget=dict(payload.get("budget", {})),
      freshness=dict(payload.get("freshness", {})),
      degradations=[dict(item) for item in payload.get("degradations", [])],
      trace=[dict(item) for item in payload.get("trace", [])],
      created_at=str(payload.get("created_at", "")),
      provider_context=dict(payload.get("provider_context", {})),
      memory_access=dict(payload.get("memory_access", {})),
      model_input=dict(payload.get("model_input", {})),
    )


def context_policy_from_profile(profile: Mapping[str, Any]) -> ContextPolicy:
  return ContextPolicy(
    input_token_ceiling=max(1, int(profile.get("input_token_ceiling", 16_000))),
    response_token_reserve=max(0, int(profile.get("response_token_reserve", 1_200))),
    include_current_scene=bool(profile.get("include_current_scene", True)),
    include_selection=bool(profile.get("include_selection", True)),
    nearby_scene_radius=max(0, int(profile.get("include_recent_scenes_radius", 1))),
    include_codex=str(profile.get("include_codex", "auto_and_explicit")),
    retrieval_mode=str(profile.get("retrieval_mode", "auto")),
    retrieval_limit=max(1, int(profile.get("retrieval_limit", 5))),
    retrieval_min_score=max(0.0, float(profile.get("retrieval_min_score", 0.0))),
    retrieval_require_fresh=bool(profile.get("retrieval_require_fresh", False)),
  )


def _bounded_content(value: str, limit: int) -> tuple[str, bool]:
  if len(value) <= limit:
    return value, False
  return value[: limit - 3].rstrip() + "...", True


def _source_path(row: Mapping[str, Any]) -> str:
  return str(row.get("source_path", row.get("path", "")))


def _context_item(
  *,
  item_id: str,
  kind: str,
  source_ref: str,
  source_title: str,
  source_path: str,
  raw_content: str,
  reason: str,
  priority: int,
  authority: int,
  source_revision: str,
  max_characters: int,
  retrieval_score: float | None = None,
  citation: Mapping[str, Any] | None = None,
) -> tuple[ContextItem, bool]:
  bounded, truncated = _bounded_content(raw_content, max_characters)
  digest = hashlib.sha256(raw_content.encode("utf-8")).hexdigest()
  estimated = estimate_tokens(raw_content)
  return (
    ContextItem(
      id=item_id,
      kind=kind,
      source_ref=source_ref,
      source_path=source_path,
      source_title=source_title,
      content=bounded,
      content_digest=digest,
      estimated_tokens=estimated,
      selection_reason=reason,
      priority=priority,
      authority=authority,
      retrieval_score=retrieval_score,
      source_revision=source_revision,
      citation=dict(citation or {}),
      preview_truncated=truncated,
    ),
    truncated,
  )


def _nearby_scene_ids(scene_rows: Sequence[Mapping[str, Any]], scene_id: str, radius: int) -> list[str]:
  ids = [str(row.get("id", "")) for row in scene_rows if str(row.get("id", ""))]
  if scene_id not in ids:
    return []
  position = ids.index(scene_id)
  return ids[max(0, position - radius) : min(len(ids), position + radius + 1)]


@serialized_project_access
def build_context_pack(
  paths: ProjectPaths,
  request: ContextRequest,
  policy: ContextPolicy,
) -> ContextPack:
  channel = request.channel.strip().lower()
  scope = request.scope.strip().lower()
  if channel not in ASSISTANT_CHANNELS:
    raise OpenAuthorError(f"Unsupported Assistant channel '{request.channel}'.")
  if scope not in CONTEXT_SCOPES:
    raise OpenAuthorError(f"Unsupported Assistant scope '{request.scope}'.")
  if request.thread_id.strip() == "":
    raise OpenAuthorError("thread_id is required for a Context Pack.")

  project = ensure_project_identity(paths)
  project_id = str(project.get("project_id", ""))
  source_revision = revision_head(paths)
  scene_inventory = list_manuscript_scenes(paths)
  requested_scene_ids: list[str] = []
  current_scene_id = request.current_scene_id.strip()
  if scope == "chapter" and not any(str(value).strip() for value in request.explicit_scene_ids):
    raise OpenAuthorError("Choose a chapter with at least one scene before sending.")
  if scope != "chapter" and policy.include_current_scene and current_scene_id:
    requested_scene_ids.append(current_scene_id)
  for raw_id in request.explicit_scene_ids:
    scene_id = str(raw_id).strip()
    if scene_id and scene_id not in requested_scene_ids:
      requested_scene_ids.append(scene_id)
  if scope == "chapter":
    # Explicit chapter membership is the focus; another open editor is only a
    # navigation state and must not silently become the first target passage.
    current_scene_id = requested_scene_ids[0]
  if scope == "project" and not requested_scene_ids and scene_inventory:
    for row in (scene_inventory[0], scene_inventory[-1]):
      scene_id = str(row.get("id", ""))
      if scene_id and scene_id not in requested_scene_ids:
        requested_scene_ids.append(scene_id)

  item_payloads: dict[str, Any] = {}
  candidates: list[BudgetCandidate] = []
  items_by_id: dict[str, ContextItem] = {}
  warnings: list[str] = []
  degradations: list[dict[str, Any]] = []
  resolved_references: list[dict[str, Any]] = []

  def add_item(item: ContextItem, payload: Any, *, required: bool, truncated: bool) -> None:
    if len(items_by_id) >= policy.max_items:
      if required:
        raise OpenAuthorError("Required Assistant context exceeds the item limit. Narrow the review scope before sending.")
      degradations.append({"item_id": item.id, "reason": "max_items"})
      return
    items_by_id[item.id] = item
    item_payloads[item.id] = payload
    candidates.append(
      BudgetCandidate(
        candidate_id=item.id,
        category=item.kind,
        serialized=json.dumps(payload, ensure_ascii=False, sort_keys=True),
        priority=item.priority,
        required=required,
      )
    )

  story_plan = story_plan_for_ai(paths, requested_scene_ids, book_scope=scope in {"project", "storyline"})
  brief = story_plan["brief"] if request.bound_brief else get_plan(paths, persist=False)["brief"]
  if any(brief.values()):
    raw_brief = json.dumps(brief, ensure_ascii=False, sort_keys=True)
    item, truncated = _context_item(
      item_id="project-brief:author", kind="project_brief", source_ref="project-brief",
      source_title="Author's project brief", source_path="manuscript/structure.json",
      raw_content=raw_brief, reason="author_intent", priority=120, authority=1,
      source_revision=source_revision,
      # Author instructions are counted in full or fail the input budget. Do
      # not account for a clipped string while sending the unbounded object.
      max_characters=max(policy.max_item_characters, len(raw_brief)),
    )
    add_item(item, brief, required=True, truncated=truncated)

  explicit_scene_set = {str(item).strip() for item in request.explicit_scene_ids}
  for scene_id in requested_scene_ids:
    scene = get_scene(paths, scene_id)
    raw = json.dumps(scene, ensure_ascii=False, sort_keys=True)
    reason = "explicit_reference" if scene_id in explicit_scene_set else "current_scope"
    item, truncated = _context_item(
      item_id=f"scene:{scene_id}",
      kind="scene",
      source_ref=scene_id,
      source_title=str(scene.get("title", "")),
      source_path=_source_path(scene),
      raw_content=raw,
      reason=reason,
      priority=100 if scene_id in explicit_scene_set else 90,
      authority=1,
      source_revision=source_revision,
      max_characters=policy.max_item_characters,
    )
    add_item(item, scene, required=scene_id in explicit_scene_set or scene_id == request.current_scene_id.strip(), truncated=truncated)
    resolved_references.append(
      {"kind": "scene", "reference_id": scene_id, "content_digest": item.content_digest}
    )

  if current_scene_id and policy.nearby_scene_radius:
    for scene_id in _nearby_scene_ids(
      scene_inventory,
      current_scene_id,
      policy.nearby_scene_radius,
    ):
      if scene_id == current_scene_id or f"scene:{scene_id}" in items_by_id:
        continue
      scene = get_scene(paths, scene_id)
      item, truncated = _context_item(
        item_id=f"nearby-scene:{scene_id}",
        kind="nearby_scene",
        source_ref=scene_id,
        source_title=str(scene.get("title", "")),
        source_path=_source_path(scene),
        raw_content=json.dumps(scene, ensure_ascii=False, sort_keys=True),
        reason="nearby_scope",
        priority=70,
        authority=1,
        source_revision=source_revision,
        max_characters=policy.max_item_characters,
      )
      add_item(item, scene, required=False, truncated=truncated)

  if policy.include_selection and request.selected_text:
    item, truncated = _context_item(
      item_id="selection:current",
      kind="selected_text",
      source_ref=request.current_scene_id.strip(),
      source_title="Author selection",
      source_path="",
      raw_content=request.selected_text,
      reason="explicit_selection",
      priority=110,
      authority=2,
      source_revision=source_revision,
      max_characters=policy.max_item_characters,
    )
    add_item(item, request.selected_text, required=True, truncated=truncated)

  codex_rows = list_entities(paths)
  explicit_codex = {str(item).strip() for item in request.explicit_codex_ids if str(item).strip()}
  known_codex = {str(row.get("id", "")): row for row in codex_rows}
  unknown_codex = explicit_codex.difference(known_codex)
  if unknown_codex:
    raise OpenAuthorError(f"Unknown codex entity id '{sorted(unknown_codex)[0]}'.")
  approved_codex = set(request.approved_codex_ids).intersection(explicit_codex)
  for entity_id in approved_codex:
    get_assistant_memory(paths, entity_id, approved_ids=approved_codex)
  grants = list(request.memory_approvals)
  for entity_id in approved_codex:
    grants.extend({"entity_id": entity_id, "detail_key": key} for key in [*([None] if known_codex[entity_id].get("ai_visibility") == "ask" else []), *[row["key"] for row in known_codex[entity_id].get("details", []) if row.get("ai_visibility") == "ask"]])
  eligible = {row["id"]: row for row in memory_for_ai(paths, grants)}
  for entity_id in explicit_codex:
    if entity_id not in eligible: get_assistant_memory(paths, entity_id, approved_ids=approved_codex)
  context_text = " ".join(
    [request.utterance, request.selected_text]
    + [str(item_payloads[item].get("body", "")) for item in item_payloads if item.startswith("scene:")]
  ).lower()
  for entity in codex_rows:
    entity_id = str(entity.get("id", ""))
    name = str(entity.get("name", "")).strip().lower()
    is_explicit = entity_id in explicit_codex
    is_auto = bool(name and name in context_text)
    include = (
      (policy.include_codex == "explicit" and is_explicit)
      or (policy.include_codex == "auto" and is_auto)
      or (policy.include_codex == "auto_and_explicit" and (is_explicit or is_auto))
    )
    if not include:
      continue
    entity = eligible.get(entity_id)
    if entity is None:
      continue
    item, truncated = _context_item(
      item_id=f"codex:{entity_id}",
      kind="codex",
      source_ref=entity_id,
      source_title=str(entity.get("name", "")),
      source_path=_source_path(entity),
      raw_content=json.dumps(entity, ensure_ascii=False, sort_keys=True),
      reason="explicit_reference" if is_explicit else "mentioned_entity",
      priority=95 if is_explicit else 75,
      authority=1,
      source_revision=source_revision,
      max_characters=policy.max_item_characters,
    )
    add_item(item, entity, required=is_explicit, truncated=truncated)
    resolved_references.append(
      {"kind": "codex", "reference_id": entity_id, "content_digest": item.content_digest}
    )

  review = build_review_context(
    paths, scene_ids=requested_scene_ids, entity_ids=tuple(explicit_codex),
    approved_codex_ids=tuple(approved_codex), project_scope=scope in {"project", "storyline"},
  )
  grounding = prepare_story_grounding(paths, requested_scene_ids, memory_approvals=grants, story_approvals=list(request.story_approvals))
  if request.bound_brief or request.memory_approvals or request.story_approvals:
    review["accepted_canon"] = []
  review["story_memory"] = grounding["context"]
  review["story_plan"] = story_plan
  # Required editorial constraints are serialized in full, not counted as a
  # clipped manifest while passing the original object to the provider.
  for key, title, path in [
    ("narrative_frame", "Plan order and chapter intent", "manuscript/structure.json"),
    ("accepted_canon", "Relevant accepted canon", "codex/memory.json"),
    ("story_memory", "Approved story grounding", "codex/memory.json"),
    ("story_plan", "Saved story direction and relevant beats", "manuscript/structure.json"),
    ("active_storyline", "Active Storyline intent", ".openauthor/workspace/storylines.json"),
    ("writing_voice", "Approved manuscript Writing Voice", ".openauthor/style_profile.json"),
    ("review_warnings", "Canon evidence warnings", "codex/memory.json"),
  ]:
    if not review[key]:
      continue
    raw = json.dumps(review[key], ensure_ascii=False, sort_keys=True)
    item, truncated = _context_item(
      item_id=f"review:{key}", kind=key, source_ref=key, source_title=title, source_path=path,
      raw_content=raw, reason="editorial_constraints", priority=115, authority=1,
      source_revision=source_revision, max_characters=max(policy.max_item_characters, len(raw)),
    )
    add_item(item, review[key], required=True, truncated=truncated)
  warnings.extend(review["review_warnings"])

  retrieval_payload: dict[str, Any] = {
    "mode": policy.retrieval_mode,
    "used": False,
    "result_count": 0,
    "citations": [],
    "error": "",
    "degraded": False,
  }
  if policy.retrieval_mode != "off":
    try:
      result = query_retrieval_index(
        paths,
        query=" ".join(
          value for value in (request.utterance, request.selected_text, current_scene_id) if value
        ),
        limit=policy.retrieval_limit,
        min_score=policy.retrieval_min_score,
        require_fresh=policy.retrieval_require_fresh,
      )
      retrieval_payload["result_count"] = int(result.get("result_count", 0))
      retrieval_payload["index"] = result.get("index", {})
      for position, row in enumerate(result.get("results", [])):
        if not isinstance(row, dict):
          continue
        citation = {
          "source_type": row.get("source_type", ""),
          "source_ref": row.get("source_ref", ""),
          "source_path": row.get("source_path", ""),
          "source_title": row.get("source_title", ""),
          "chunk_id": row.get("chunk_id", ""),
          "score": row.get("score"),
          "excerpt": str(row.get("text", ""))[:240],
        }
        item_id = f"retrieval:{row.get('chunk_id', position)}"
        item, truncated = _context_item(
          item_id=item_id,
          kind="retrieval",
          source_ref=str(row.get("source_ref", "")),
          source_title=str(row.get("source_title", "")),
          source_path=str(row.get("source_path", "")),
          raw_content=str(row.get("text", "")),
          reason="query_relevance",
          priority=60,
          authority=4,
          source_revision=source_revision,
          max_characters=policy.max_item_characters,
          retrieval_score=float(row.get("score", 0.0)),
          citation=citation,
        )
        add_item(item, row, required=False, truncated=truncated)
    except OpenAuthorError as error:
      if policy.retrieval_mode == "required":
        raise
      retrieval_payload.update({"degraded": True, "error": str(error)})
      warnings.append("Retrieval context was unavailable; the pack uses local anchors only.")

  continuity = run_continuity_checks(paths)
  continuity_item, truncated = _context_item(
    item_id="continuity:current",
    kind="continuity",
    source_ref="project",
    source_title="Continuity checks",
    source_path="",
    raw_content=json.dumps(continuity, ensure_ascii=False, sort_keys=True),
    reason="project_safety",
    priority=40,
    authority=3,
    source_revision=source_revision,
    max_characters=policy.max_item_characters,
  )
  add_item(continuity_item, continuity, required=False, truncated=truncated)

  if scope == "project":
    scene_index = [
      {
        "id": row.get("id", ""),
        "title": row.get("title", ""),
        "summary": row.get("summary", ""),
        "pov": row.get("pov", ""),
        "status": row.get("status", ""),
      }
      for row in scene_inventory[:40]
    ]
    index_item, truncated = _context_item(
      item_id="scene-index:book",
      kind="scene_index",
      source_ref="project",
      source_title="Book scene index",
      source_path="manuscript/structure.json",
      raw_content=json.dumps(scene_index, ensure_ascii=False, sort_keys=True),
      reason="project_scope",
      priority=30,
      authority=3,
      source_revision=source_revision,
      max_characters=policy.max_item_characters,
    )
    add_item(index_item, scene_index, required=False, truncated=truncated)

  # Keep user-led exchanges together and admit a contiguous newest suffix.
  history_groups: list[list[dict[str, Any]]] = []
  for row in request.history:
    if row.get("role") == "user":
      history_groups.append([dict(row)])
    elif history_groups:
      history_groups[-1].append(dict(row))
  for position in reversed(range(len(history_groups))):
    candidates.append(BudgetCandidate(
      candidate_id=f"history:{position}", category="history",
      serialized=json.dumps(history_groups[position], ensure_ascii=False, sort_keys=True),
      priority=50, ordered_group="recent-history",
    ))

  def history_for(selected_ids: set[str]) -> list[dict[str, Any]]:
    return [row for position, group in enumerate(history_groups) if f"history:{position}" in selected_ids for row in group]

  def context_for(selected_ids: set[str]) -> dict[str, Any]:
    selected_items = [item for item_id, item in items_by_id.items() if item_id in selected_ids]
    selected_citations = [item.citation for item in selected_items if item.kind == "retrieval"]
    return {
      **review,
      "project_brief": item_payloads.get("project-brief:author", {}) if "project-brief:author" in selected_ids else {},
      "current_scene": [item_payloads[item.id] for item in selected_items if item.kind == "scene"],
      "nearby_scenes": [item_payloads[item.id] for item in selected_items if item.kind == "nearby_scene"],
      "selected_text": item_payloads["selection:current"] if "selection:current" in selected_ids else "",
      "codex_entities": [item_payloads[item.id] for item in selected_items if item.kind == "codex"],
      "continuity_issues": continuity if "continuity:current" in selected_ids else [],
      "retrieval": {**retrieval_payload, "citations": selected_citations, "used": bool(selected_citations)},
      "book_scene_index": item_payloads.get("scene-index:book", []) if "scene-index:book" in selected_ids else [],
      "book_scene_count": len(scene_inventory) if scope == "project" else 0,
    }

  reserve = max(policy.response_token_reserve, response_token_limit(channel, policy.response_token_reserve))

  def input_for(selected_ids: set[str]) -> dict[str, Any]:
    return build_model_input(
      channel=channel, context=context_for(selected_ids), history=history_for(selected_ids),
      utterance=request.utterance, scope=scope, project_revision=source_revision,
      agent_mode=request.agent_mode, response_reserve=policy.response_token_reserve,
    )

  allocation = allocate_input_budget(
    candidates,
    BudgetPolicy(input_token_ceiling=policy.input_token_ceiling),
    measure_selected=lambda selected: estimate_model_input(input_for({candidate.candidate_id for candidate in selected})) + reserve,
  )
  selected_ids = {candidate.candidate_id for candidate in allocation.selected}
  selected_items = [item for item_id, item in items_by_id.items() if item_id in selected_ids]
  selected_history = history_for(selected_ids)
  provider_context = context_for(selected_ids)
  model_input = input_for(selected_ids)
  selected_citations = [item.citation for item in selected_items if item.kind == "retrieval"]
  degradations.extend(dict(entry) for entry in allocation.dropped)
  trace = [
    {
      "item_id": item.id,
      "kind": item.kind,
      "source_ref": item.source_ref,
      "content_digest": item.content_digest,
      "selection_reason": item.selection_reason,
    }
    for item in selected_items
  ]
  prompt_brief = (
    f"Scope: {scope}. Selected {len(selected_items)} evidence item(s); "
    f"{len(allocation.dropped)} candidate(s) omitted by policy."
  )
  memory_access = memory_access_stamp(codex_rows, approved_ids=approved_codex)
  identity = {
    "schema_version": CONTEXT_PACK_SCHEMA_VERSION,
    "input_policy_version": 2,
    "model_input": model_input,
    "project_id": project_id,
    "project_revision": source_revision,
    "thread_id": request.thread_id,
    "channel": channel,
    "scope": scope,
    "utterance_sha256": hashlib.sha256(request.utterance.encode("utf-8")).hexdigest(),
    "items": [(item.id, item.content_digest) for item in selected_items],
    "history": selected_history,
    "policy": asdict(policy),
    "memory_access": memory_access,
  }
  pack_id = "ctx-" + hashlib.sha256(
    json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
  ).hexdigest()[:24]
  pack_path = paths.chats_dir / "context-packs" / f"{pack_id}.json"
  if pack_path.exists():
    try:
      existing = json.loads(pack_path.read_text(encoding="utf-8"))
      if isinstance(existing, dict):
        return ContextPack.from_dict(existing)
    except json.JSONDecodeError:
      pass
  pack = ContextPack(
    schema_version=CONTEXT_PACK_SCHEMA_VERSION,
    pack_id=pack_id,
    project_id=project_id,
    project_revision=source_revision,
    thread_id=request.thread_id,
    channel=channel,
    scope=scope,
    items=selected_items,
    history=selected_history,
    prompt_brief=prompt_brief,
    resolved_references=resolved_references,
    citations=selected_citations,
    warnings=warnings,
    conflicts=[],
    budget={
      "ceiling": allocation.input_token_ceiling,
      "used": allocation.used_tokens,
      "remaining": allocation.remaining_tokens,
      "allocations": {"input_payload": allocation.used_tokens - reserve, "response_reserve": reserve},
      "input_policy_version": 2,
      "estimator": TOKEN_ESTIMATOR_VERSION,
      "is_estimate": True,
    },
    freshness={
      "status": "degraded" if retrieval_payload.get("degraded") else "fresh",
      "stale_sources": [],
    },
    degradations=degradations,
    trace=trace,
    created_at=utc_now(),
    provider_context=provider_context,
    memory_access=memory_access,
    model_input=model_input,
  )
  atomic_write_json(pack_path, pack.to_dict())
  return pack


def validate_memory_access(paths: ProjectPaths, pack: ContextPack) -> None:
  approved = pack.memory_access.get("approved_ids", [])
  if not isinstance(approved, list) or pack.memory_access != memory_access_stamp(list_entities(paths), approved_ids=approved):
    raise OpenAuthorError("Story Memory access or content changed. Prepare a new voice context before connecting.")


def load_context_pack(paths: ProjectPaths, pack_id: str) -> ContextPack:
  normalized = pack_id.strip()
  if not normalized.startswith("ctx-") or not normalized[4:].isalnum():
    raise OpenAuthorError("Invalid Context Pack id.")
  path = paths.chats_dir / "context-packs" / f"{normalized}.json"
  if not path.exists():
    raise OpenAuthorError(f"Context Pack '{normalized}' not found.")
  try:
    payload = json.loads(path.read_text(encoding="utf-8"))
  except json.JSONDecodeError as error:
    raise OpenAuthorError(f"Context Pack '{normalized}' is invalid.") from error
  if not isinstance(payload, dict) or payload.get("pack_id") != normalized:
    raise OpenAuthorError(f"Context Pack '{normalized}' is invalid.")
  return ContextPack.from_dict(payload)
