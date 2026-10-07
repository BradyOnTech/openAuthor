"""Order already permitted Memory records against the supplied scene guidance."""
from __future__ import annotations

import re
from typing import Any


def _reference_forms(entity: dict[str, Any]) -> list[str]:
  label = str(entity.get("name", "")).strip()
  name = label.casefold()
  forms = [name, *(alias.strip().casefold() for alias in entity.get("aliases", []) if isinstance(alias, str))]
  # Labels can append a descriptive clause, as in "The Tidewardens, people of
  # Lumen". These lookup forms do not rename records or create saved aliases.
  head, comma, description = label.partition(",")
  if comma and description.strip()[:1].islower():
    forms.append(head.strip().casefold())
  forms += [form[4:] for form in forms if form.startswith("the ") and len(form[4:]) >= 3]
  return list(dict.fromkeys(form for form in forms if form))


def prioritize_scene_memory(
  records: list[dict[str, Any]], *, scene: dict[str, Any], direction: str,
  supporting_text: str,
) -> list[dict[str, Any]]:
  """Keep viewpoint and direct scene subjects before broader book references."""
  primary = "\n".join(str(scene.get(key, "")) for key in ("title", "summary", "body")) + "\n" + direction
  primary, supporting = primary.casefold(), supporting_text.casefold()
  pov = str(scene.get("pov", "")).strip().casefold()

  def priority(entity: dict[str, Any]) -> int:
    forms = _reference_forms(entity)
    if entity.get("type") == "character" and pov and pov in forms:
      return 0
    patterns = [r"(?<!\w)" + re.escape(form) + r"(?!\w)" for form in forms]
    if any(re.search(pattern, primary) for pattern in patterns):
      return 1
    if any(re.search(pattern, supporting) for pattern in patterns):
      return 2
    return 3

  # Stable ties retain the existing record order. Do not use arbitrary IDs or
  # read extra manuscript/record content to resolve equal relevance.
  return sorted(records, key=priority)
