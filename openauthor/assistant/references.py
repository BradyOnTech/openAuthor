from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

from ..project import OpenAuthorError

ReferenceResolver = Callable[[str], Mapping[str, object]]


@dataclass(frozen=True)
class ContextReference:
  kind: str
  reference_id: str

  def __post_init__(self) -> None:
    normalized_kind = self.kind.strip().lower()
    normalized_id = self.reference_id.strip()
    if normalized_kind == "":
      raise ValueError("Context reference kind cannot be empty.")
    if normalized_id == "":
      raise ValueError("Context reference id cannot be empty.")
    object.__setattr__(self, "kind", normalized_kind)
    object.__setattr__(self, "reference_id", normalized_id)


@dataclass(frozen=True)
class ReferencePolicy:
  max_references: int = 8
  max_content_characters: int = 4000

  def __post_init__(self) -> None:
    if self.max_references < 1:
      raise ValueError("max_references must be >= 1.")
    if self.max_content_characters < 4:
      raise ValueError("max_content_characters must be >= 4.")


@dataclass(frozen=True)
class ResolvedContextReference:
  kind: str
  reference_id: str
  title: str
  source_path: str
  source_revision: str
  content: str
  content_digest: str
  truncated: bool


@dataclass(frozen=True)
class ResolvedReferenceSet:
  references: list[ResolvedContextReference]
  trace: list[dict[str, object]]


def resolve_context_references(
  references: Sequence[ContextReference],
  *,
  resolvers: Mapping[str, ReferenceResolver],
  policy: ReferencePolicy | None = None,
  expected_project_id: str = "",
) -> ResolvedReferenceSet:
  """Resolve bounded opaque references without leaking evidence into traces.

  Resolution is all-or-nothing. Every result is validated before any resolved
  value is returned to the caller.
  """

  normalized_policy = policy or ReferencePolicy()
  normalized_project_id = expected_project_id.strip()
  if len(references) > normalized_policy.max_references:
    raise OpenAuthorError(
      f"At most {normalized_policy.max_references} context references are allowed."
    )

  deduplicated: list[ContextReference] = []
  seen: set[tuple[str, str]] = set()
  for reference in references:
    key = (reference.kind, reference.reference_id)
    if key in seen:
      continue
    if reference.kind not in resolvers:
      raise OpenAuthorError(
        f"Unsupported context reference kind '{reference.kind}'."
      )
    seen.add(key)
    deduplicated.append(reference)

  resolved_references: list[ResolvedContextReference] = []
  for reference in deduplicated:
    resolver = resolvers[reference.kind]
    try:
      raw = resolver(reference.reference_id)
    except OpenAuthorError:
      raise
    except Exception as error:
      raise OpenAuthorError(
        f"Unable to resolve {reference.kind} reference '{reference.reference_id}'."
      ) from error
    resolved_id = str(raw.get("id", "")).strip()
    if resolved_id != reference.reference_id:
      raise OpenAuthorError(
        f"Resolved {reference.kind} reference identity did not match the request."
      )
    if normalized_project_id:
      resolved_project_id = str(raw.get("project_id", "")).strip()
      if resolved_project_id != normalized_project_id:
        raise OpenAuthorError(
          f"Resolved {reference.kind} reference project identity did not match the request."
        )
    content = str(raw.get("content", ""))
    if content.strip() == "":
      raise OpenAuthorError(
        f"Resolved {reference.kind} reference '{reference.reference_id}' has no content."
      )
    content_digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    truncated = len(content) > normalized_policy.max_content_characters
    bounded_content = content
    if truncated:
      bounded_content = (
        content[: normalized_policy.max_content_characters - 3].rstrip() + "..."
      )
    resolved_references.append(
      ResolvedContextReference(
        kind=reference.kind,
        reference_id=reference.reference_id,
        title=str(raw.get("title", "")).strip(),
        source_path=str(raw.get("source_path", "")).strip(),
        source_revision=str(raw.get("source_revision", "")).strip(),
        content=bounded_content,
        content_digest=content_digest,
        truncated=truncated,
      )
    )

  trace = [
    {
      "kind": reference.kind,
      "reference_id": reference.reference_id,
      "source_path": reference.source_path,
      "source_revision": reference.source_revision,
      "content_digest": reference.content_digest,
      "truncated": reference.truncated,
    }
    for reference in resolved_references
  ]
  return ResolvedReferenceSet(references=resolved_references, trace=trace)
