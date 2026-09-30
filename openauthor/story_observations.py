from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from typing import Any

from .story_memory import _consolidate_character_names, _identity_key, _proper_name_mentions

UNCERTAIN = re.compile(r"\b(?:if|would|could|might|perhaps|suppose|imagined?|dream(?:s|ed|t)?|remembered|used to|not|never|no longer|seemed|claimed|lied)\b", re.IGNORECASE)


def _narration(body: str) -> str:
  # Keep offsets intact while excluding direct speech, including multiline and
  # unfinished quotes. A quoted claim is not an established story-world fact.
  return re.sub(r'"[^"]*(?:"|$)|“[^”]*(?:”|$)', lambda match: re.sub(r"[^\n]", " ", match.group(0)), body)


def _character_labels(scenes: list[dict[str, Any]], entities: list[dict[str, Any]]) -> dict[str, str | None]:
  counts: Counter[str] = Counter()
  pov_names: set[str] = set()
  for scene in scenes:
    counts.update(name for name, _, _ in _proper_name_mentions(scene["body"]))
    if scene.get("pov"):
      counts[scene["pov"]] += 3
      pov_names.add(scene["pov"])
  aliases = _consolidate_character_names(counts, defaultdict(list), pov_names)
  identities: dict[str, set[str]] = defaultdict(set)
  accepted_labels: set[str] = set()
  for entity in entities:
    if entity.get("type") != "character":
      continue
    for label in [entity["name"], *entity.get("aliases", [])]:
      identities[str(label)].add(entity["name"])
      accepted_labels.add(_identity_key(str(label)))
  for name, count in counts.items():
    if count < 2 or _identity_key(name) in accepted_labels:
      continue
    for label in [name, *aliases.get(name, [])]:
      identities[label].add(name)
  # Ambiguous aliases must not attribute a physical detail to the wrong person.
  return {label: next(iter(names)) if len(names) == 1 else None for label, names in identities.items()}


def prose_trait_diagnostics(scenes: list[dict[str, Any]], entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
  """Local, limited pattern checks: observations are never promoted to Canon."""
  labels = _character_labels(scenes, entities)
  if not labels:
    return []
  by_name = {_identity_key(label): name for label, name in labels.items()}
  names = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
  mentions = re.compile(rf"(?<!\w)(?:{names})(?!\w)", re.IGNORECASE)
  owner = rf"(?P<owner>(?:{names})['’]s|her|his|their)"
  numbers = {word: str(index) for index, word in enumerate(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"])}
  count = rf"(?P<count>{'|'.join(numbers)}|\d{{1,2}})"
  fingers = re.compile(rf"(?<!\w){owner}\s+(?P<side>left|right)\s+hand(?:\s+(?:still\s+)?(?:had|has)\s+(?:only\s+)?|,\s+(?:all\s+)?){count}\s+fingers\b", re.IGNORECASE)
  colors = re.compile(rf"(?<!\w){owner}\s+(?P<feature>eyes|hair)\s+(?:were|are|was|is)\s+(?P<color>(?:(?:light|dark)\s+)?(?:blue|green|brown|black|white|gray|grey|hazel|amber|red|auburn|blond|blonde|silver))\b", re.IGNORECASE)
  observations: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
  for scene in scenes:
    last_subject = None
    last_named_end = 0
    for sentence in re.finditer(r"[^.!?\n]+[.!?]?", _narration(scene["body"])):
      text = sentence.group(0)
      if sentence.start() - last_named_end > 240 or re.search(r"\n\s*\n", scene["body"][last_named_end:sentence.start()]):
        last_subject = None
      named = {by_name[_identity_key(match.group(0))] for match in mentions.finditer(text)}
      if UNCERTAIN.search(text):
        if named:
          last_subject = None
        continue
      for match in [*fingers.finditer(text), *colors.finditer(text)]:
        owner_text = match.group("owner")
        preceding = {by_name[_identity_key(mention.group(0))] for mention in mentions.finditer(text[:match.start()])}
        explicit = owner_text.endswith(("'s", "’s"))
        subject = by_name.get(_identity_key(owner_text[:-2])) if explicit else (next(iter(preceding)) if len(preceding) == 1 else last_subject if not named else None)
        if not subject:
          continue
        if "count" in match.groupdict():
          trait = f"{match.group('side').lower()} hand finger count"
          value = numbers.get(match.group("count").lower(), match.group("count"))
        else:
          trait = "eye color" if match.group("feature").lower() == "eyes" else "hair color"
          value = " ".join(match.group("color").lower().split()).replace("grey", "gray").replace("blonde", "blond")
        start = sentence.start() + len(text) - len(text.lstrip())
        end = sentence.end() - len(text) + len(text.rstrip())
        attribution = "explicit name" if explicit else "same-sentence name; review attribution" if preceding else "nearby name; review attribution"
        observations[(subject, trait)].append({"value": value, "evidence": {"scene_id": scene["id"], "excerpt": scene["body"][start:end], "start": start, "end": end, "attribution": attribution}})
      if named:
        last_subject = next(iter(named)) if len(named) == 1 else None
        last_named_end = sentence.end()
  diagnostics: list[dict[str, Any]] = []
  for (subject, trait), rows in observations.items():
    values = list(dict.fromkeys(row["value"] for row in rows))
    if len(values) < 2:
      continue
    evidence = [row["evidence"] for row in rows]
    identity = f"{subject}:{trait}:" + ":".join(f"{item['scene_id']}:{item['excerpt']}" for item in evidence)
    diagnostics.append({
      "id": "memory-diagnostic-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16],
      "code": "prose_trait_mismatch",
      "severity": "warning",
      "title": "Possible physical-detail mismatch",
      "message": f"{subject}'s {trait} is described as {' and '.join(values)}. Review the passages for an intentional change or a mistaken attribution; no Canon Fact was changed." + (" Pronoun ownership was inferred from a nearby name and needs confirmation." if any(item["attribution"] != "explicit name" for item in evidence) else ""),
      "fact_ids": [],
      "scene_ids": list(dict.fromkeys(item["scene_id"] for item in evidence)),
      "evidence": evidence,
    })
  return diagnostics
