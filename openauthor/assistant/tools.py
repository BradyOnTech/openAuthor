from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from ..project import OpenAuthorError

TOOL_EFFECTS = {"read", "propose", "mutate", "risky"}
TOOL_CHANNELS = {"text", "desktop_voice", "mobile_voice"}
VOICE_CHANNELS = frozenset({"desktop_voice", "mobile_voice"})


def _schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
  return {"type": "object", "properties": properties, "required": required}


@dataclass(frozen=True)
class ToolDefinition:
  name: str
  description: str
  parameters: dict[str, Any]
  effect: str
  channels: frozenset[str] = frozenset({"text"})

  @property
  def wire_name(self) -> str:
    return self.name.replace(".", "_")


class ToolRegistry:
  """Validated source of truth for model-visible Assistant tools."""

  def __init__(self, definitions: Iterable[ToolDefinition]) -> None:
    by_name: dict[str, ToolDefinition] = {}
    by_wire_name: dict[str, ToolDefinition] = {}
    for definition in definitions:
      if definition.name.strip() == "":
        raise ValueError("Tool name cannot be empty.")
      if definition.effect not in TOOL_EFFECTS:
        raise ValueError(
          f"Unsupported effect '{definition.effect}' for tool '{definition.name}'."
        )
      unsupported_channels = set(definition.channels) - TOOL_CHANNELS
      if unsupported_channels:
        names = ", ".join(sorted(unsupported_channels))
        raise ValueError(
          f"Unsupported channels for tool '{definition.name}': {names}."
        )
      if definition.name in by_name:
        raise ValueError(f"Duplicate tool name '{definition.name}'.")
      if definition.wire_name in by_wire_name:
        raise ValueError(f"Duplicate tool wire name '{definition.wire_name}'.")
      by_name[definition.name] = definition
      by_wire_name[definition.wire_name] = definition
    self._by_name = by_name
    self._by_wire_name = by_wire_name

  def definitions(self, *, channel: str = "text") -> list[ToolDefinition]:
    normalized_channel = channel.strip().lower()
    if normalized_channel not in TOOL_CHANNELS:
      raise OpenAuthorError(f"Unsupported Assistant channel '{channel}'.")
    return [
      definition
      for definition in self._by_name.values()
      if normalized_channel in definition.channels
    ]

  def provider_specs(self, *, channel: str = "text") -> list[dict[str, Any]]:
    return [
      {
        "name": definition.wire_name,
        "description": definition.description,
        "parameters": definition.parameters,
      }
      for definition in self.definitions(channel=channel)
    ]

  def realtime_specs(self, *, channel: str) -> list[dict[str, Any]]:
    return [
      {
        "type": "function",
        "name": definition.wire_name,
        "description": definition.description,
        "parameters": definition.parameters,
      }
      for definition in self.definitions(channel=channel)
    ]

  def internal_name(self, wire_name: str) -> str:
    definition = self._by_wire_name.get(wire_name)
    if definition is None:
      raise OpenAuthorError(f"Unknown Assistant tool '{wire_name}'.")
    return definition.name

  def effect(self, internal_name: str) -> str:
    definition = self._by_name.get(internal_name)
    if definition is None:
      raise OpenAuthorError(f"Unknown Assistant tool '{internal_name}'.")
    return definition.effect

  def legacy_classification(self, internal_name: str) -> str:
    effect = self.effect(internal_name)
    if effect == "read":
      return "read"
    if effect == "risky":
      return "risky"
    return "write"


TEXT_ONLY = frozenset({"text"})
TEXT_AND_VOICE = frozenset({"text", *VOICE_CHANNELS})

DEFAULT_TOOL_REGISTRY = ToolRegistry(
  [
    ToolDefinition(
      name="scene.list",
      description="List all scenes with ids, titles, POV, and status.",
      parameters=_schema({}, []),
      effect="read",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="scene.get",
      description="Fetch one scene (frontmatter and body) by id.",
      parameters=_schema(
        {"id": {"type": "string", "description": "Scene id, e.g. scene-0001."}},
        ["id"],
      ),
      effect="read",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="codex.list",
      description="List codex entities (characters, places, items, lore).",
      parameters=_schema({}, []),
      effect="read",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="codex.get",
      description="Fetch one codex entity by id.",
      parameters=_schema(
        {"id": {"type": "string", "description": "Codex entity id."}},
        ["id"],
      ),
      effect="read",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="retrieval.query",
      description="Search the local manuscript/codex retrieval index; returns cited excerpts.",
      parameters=_schema(
        {
          "text": {"type": "string", "description": "Search query."},
          "limit": {"type": "integer", "description": "Max results (default 5)."},
          "min_score": {"type": "number", "description": "Minimum relevance score."},
          "require_fresh": {
            "type": "boolean",
            "description": "Fail if the index is stale.",
          },
        },
        ["text"],
      ),
      effect="read",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="check.continuity",
      description="Run continuity checks across the whole project.",
      parameters=_schema({}, []),
      effect="read",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="branch.status",
      description="Show the git branch and workspace status of the project.",
      parameters=_schema({}, []),
      effect="read",
      channels=TEXT_ONLY,
    ),
    ToolDefinition(
      name="proposal.add",
      description="Queue a manuscript edit proposal for the author to review (never edits directly).",
      parameters=_schema(
        {
          "title": {"type": "string", "description": "Short proposal title."},
          "instruction": {
            "type": "string",
            "description": "Proposal body with Intent, Constraints, Edit Plan, Continuity Notes sections.",
          },
          "scene_id": {"type": "string", "description": "Target scene id."},
        },
        ["title", "instruction", "scene_id"],
      ),
      effect="propose",
      channels=TEXT_AND_VOICE,
    ),
    ToolDefinition(
      name="proposal.generate",
      description="Generate a full AI proposal for a scene through the budgeted generation pipeline.",
      parameters=_schema(
        {
          "scene_id": {"type": "string", "description": "Target scene id."},
          "instruction": {
            "type": "string",
            "description": "What the proposal should accomplish.",
          },
          "title": {"type": "string", "description": "Optional proposal title."},
          "provider": {
            "type": "string",
            "description": "AI provider (defaults to local).",
          },
          "model": {"type": "string", "description": "Optional model override."},
          "retrieval_mode": {
            "type": "string",
            "description": "off, auto, or required.",
          },
        },
        ["scene_id", "instruction"],
      ),
      effect="propose",
      channels=TEXT_ONLY,
    ),
    ToolDefinition(
      name="codex.add",
      description="Add a codex entity.",
      parameters=_schema(
        {
          "type": {
            "type": "string",
            "description": "Entity type (character, place, item, lore).",
          },
          "name": {"type": "string", "description": "Entity name."},
          "description": {"type": "string", "description": "Entity description."},
        },
        ["type", "name"],
      ),
      effect="mutate",
    ),
    ToolDefinition(
      name="codex.update",
      description="Update fields on an existing codex entity.",
      parameters=_schema(
        {
          "id": {"type": "string", "description": "Entity id."},
          "type": {"type": "string", "description": "New entity type."},
          "name": {"type": "string", "description": "New name."},
          "description": {"type": "string", "description": "New description."},
        },
        ["id"],
      ),
      effect="mutate",
    ),
    ToolDefinition(
      name="snapshot.create",
      description="Create a git snapshot commit of the current authoring state.",
      parameters=_schema(
        {"message": {"type": "string", "description": "Snapshot commit message."}},
        ["message"],
      ),
      effect="mutate",
    ),
    ToolDefinition(
      name="branch.create",
      description="Create (and by default switch to) a new draft branch.",
      parameters=_schema(
        {
          "name": {"type": "string", "description": "Branch name."},
          "from_ref": {"type": "string", "description": "Optional base ref."},
          "no_switch": {
            "type": "boolean",
            "description": "Create without switching.",
          },
        },
        ["name"],
      ),
      effect="mutate",
    ),
    ToolDefinition(
      name="branch.switch",
      description="Switch to an existing branch.",
      parameters=_schema(
        {"name": {"type": "string", "description": "Branch name."}},
        ["name"],
      ),
      effect="mutate",
    ),
    ToolDefinition(
      name="merge.preflight",
      description="Check whether a branch merge would apply cleanly.",
      parameters=_schema(
        {
          "base": {"type": "string", "description": "Base branch."},
          "head": {"type": "string", "description": "Head branch."},
        },
        ["base", "head"],
      ),
      effect="propose",
    ),
    ToolDefinition(
      name="merge.apply",
      description="Merge one branch into another. Requires author approval.",
      parameters=_schema(
        {
          "base": {"type": "string", "description": "Base branch."},
          "head": {"type": "string", "description": "Head branch."},
        },
        ["base", "head"],
      ),
      effect="risky",
    ),
  ]
)
