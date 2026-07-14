from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from .project import OpenAuthorError, ProjectPaths, atomic_write_json, utc_now

ENTITY_TYPES = {"character", "location", "lore", "item", "faction", "event"}
CODEX_DIRECTORY_KIND_MAP = {
  "character": "character",
  "characters": "character",
  "location": "location",
  "locations": "location",
  "lore": "lore",
  "item": "item",
  "items": "item",
  "faction": "faction",
  "factions": "faction",
  "event": "event",
  "events": "event",
}


def initialize_codex(db_path: str) -> None:
  connection = sqlite3.connect(db_path)
  try:
    cursor = connection.cursor()
    cursor.execute(
      """
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      """
    )
    cursor.execute(
      """
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(source_entity_id) REFERENCES entities(id),
        FOREIGN KEY(target_entity_id) REFERENCES entities(id)
      )
      """
    )
    connection.commit()
  finally:
    connection.close()


def ensure_codex(paths: ProjectPaths) -> None:
  initialize_codex(str(paths.codex_db))


def _codex_snapshot_path(paths: ProjectPaths) -> Path:
  return paths.root / "codex" / "codex.json"


def _validate_codex_snapshot(payload: Any, *, snapshot_path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
  if not isinstance(payload, dict):
    raise OpenAuthorError(f"Invalid codex snapshot payload at {snapshot_path}.")
  entities = payload.get("entities", [])
  relationships = payload.get("relationships", [])
  if not isinstance(entities, list):
    raise OpenAuthorError(f"Invalid codex snapshot entities at {snapshot_path}.")
  if not isinstance(relationships, list):
    raise OpenAuthorError(f"Invalid codex snapshot relationships at {snapshot_path}.")
  entity_rows = [row for row in entities if isinstance(row, dict)]
  relationship_rows = [row for row in relationships if isinstance(row, dict)]
  return entity_rows, relationship_rows


def replace_runtime_codex_from_snapshot(paths: ProjectPaths) -> dict[str, Any]:
  ensure_codex(paths)
  snapshot_path = _codex_snapshot_path(paths)
  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    cursor.execute("DELETE FROM relationships")
    cursor.execute("DELETE FROM entities")

    if not snapshot_path.exists():
      connection.commit()
      return {
        "source": "none",
        "imported": True,
        "entities": 0,
        "relationships": 0,
      }

    try:
      payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
      raise OpenAuthorError(f"Invalid codex snapshot JSON at {snapshot_path}.") from error

    entity_rows, relationship_rows = _validate_codex_snapshot(
      payload,
      snapshot_path=snapshot_path,
    )
    now = utc_now()
    entity_ids: set[str] = set()
    seen_names: set[str] = set()
    for row in entity_rows:
      entity_id = str(row.get("id", "")).strip()
      kind = str(row.get("type", "")).strip()
      name = str(row.get("name", "")).strip()
      description = str(row.get("description", ""))
      created_at = str(row.get("created_at", "")).strip() or now
      updated_at = str(row.get("updated_at", "")).strip() or now
      if entity_id == "" or kind == "" or name == "":
        continue
      if kind not in ENTITY_TYPES:
        raise OpenAuthorError(
          f"Invalid entity type '{kind}' in codex snapshot {snapshot_path}."
        )
      if entity_id in entity_ids or name in seen_names:
        raise OpenAuthorError(
          f"Duplicate entity id or name '{entity_id}'/'{name}' in codex snapshot {snapshot_path}."
        )
      seen_names.add(name)
      cursor.execute(
        """
        INSERT INTO entities (id, kind, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (entity_id, kind, name, description, created_at, updated_at),
      )
      entity_ids.add(entity_id)

    imported_relationships = 0
    for row in relationship_rows:
      relationship_id = str(row.get("id", "")).strip()
      source_entity_id = str(row.get("source_entity_id", "")).strip()
      target_entity_id = str(row.get("target_entity_id", "")).strip()
      relation = str(row.get("relation", "")).strip()
      notes = str(row.get("notes", ""))
      created_at = str(row.get("created_at", "")).strip() or now
      if (
        relationship_id == ""
        or source_entity_id == ""
        or target_entity_id == ""
        or relation == ""
      ):
        continue
      if source_entity_id not in entity_ids or target_entity_id not in entity_ids:
        continue
      cursor.execute(
        """
        INSERT INTO relationships (
          id, source_entity_id, target_entity_id, relation, notes, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
          relationship_id,
          source_entity_id,
          target_entity_id,
          relation,
          notes,
          created_at,
        ),
      )
      imported_relationships += 1
    connection.commit()
  finally:
    connection.close()

  return {
    "source": "snapshot",
    "imported": True,
    "entities": len(entity_ids),
    "relationships": imported_relationships,
  }


def add_entity(
  paths: ProjectPaths,
  *,
  kind: str,
  name: str,
  description: str = "",
) -> str:
  if kind not in ENTITY_TYPES:
    allowed = ", ".join(sorted(ENTITY_TYPES))
    raise OpenAuthorError(f"Invalid entity type '{kind}'. Allowed: {allowed}.")

  ensure_codex(paths)
  entity_id = f"entity-{uuid.uuid4().hex[:12]}"
  timestamp = utc_now()
  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    cursor.execute(
      """
      INSERT INTO entities (id, kind, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      """,
      (entity_id, kind, name, description, timestamp, timestamp),
    )
    connection.commit()
  except sqlite3.IntegrityError as error:
    raise OpenAuthorError(f"Entity with name '{name}' already exists.") from error
  finally:
    connection.close()
  export_codex_json(paths)
  return entity_id


def list_entities(paths: ProjectPaths, *, kind: str | None = None) -> list[dict[str, str]]:
  ensure_codex(paths)
  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    if kind:
      rows = cursor.execute(
        """
        SELECT id, kind, name, description, created_at, updated_at
        FROM entities
        WHERE kind = ?
        ORDER BY name ASC
        """,
        (kind,),
      ).fetchall()
    else:
      rows = cursor.execute(
        """
        SELECT id, kind, name, description, created_at, updated_at
        FROM entities
        ORDER BY kind ASC, name ASC
        """
      ).fetchall()
  finally:
    connection.close()

  return [
    {
      "id": row[0],
      "type": row[1],
      "name": row[2],
      "description": row[3],
      "created_at": row[4],
      "updated_at": row[5],
    }
    for row in rows
  ]


def get_entity(paths: ProjectPaths, entity_id: str) -> dict[str, str]:
  ensure_codex(paths)
  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    row = cursor.execute(
      """
      SELECT id, kind, name, description, created_at, updated_at
      FROM entities
      WHERE id = ?
      """,
      (entity_id,),
    ).fetchone()
  finally:
    connection.close()

  if row is None:
    raise OpenAuthorError(f"Unknown codex entity id '{entity_id}'.")

  return {
    "id": row[0],
    "type": row[1],
    "name": row[2],
    "description": row[3],
    "created_at": row[4],
    "updated_at": row[5],
  }


def update_entity(
  paths: ProjectPaths,
  *,
  entity_id: str,
  kind: str | None = None,
  name: str | None = None,
  description: str | None = None,
) -> dict[str, str]:
  if kind is not None and kind not in ENTITY_TYPES:
    allowed = ", ".join(sorted(ENTITY_TYPES))
    raise OpenAuthorError(f"Invalid entity type '{kind}'. Allowed: {allowed}.")

  current = get_entity(paths, entity_id)
  next_kind = kind if kind is not None else current["type"]
  next_name = name if name is not None else current["name"]
  next_description = description if description is not None else current["description"]
  next_updated_at = utc_now()

  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    cursor.execute(
      """
      UPDATE entities
      SET kind = ?, name = ?, description = ?, updated_at = ?
      WHERE id = ?
      """,
      (next_kind, next_name, next_description, next_updated_at, entity_id),
    )
    connection.commit()
  except sqlite3.IntegrityError as error:
    raise OpenAuthorError(f"Entity with name '{next_name}' already exists.") from error
  finally:
    connection.close()

  updated = {
    "id": entity_id,
    "type": next_kind,
    "name": next_name,
    "description": next_description,
    "created_at": current["created_at"],
    "updated_at": next_updated_at,
  }
  export_codex_json(paths)
  return updated


def export_codex_json(paths: ProjectPaths) -> Path:
  ensure_codex(paths)
  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    entity_rows = cursor.execute(
      """
      SELECT id, kind, name, description, created_at, updated_at
      FROM entities
      ORDER BY kind ASC, name ASC
      """
    ).fetchall()
    relationship_rows = cursor.execute(
      """
      SELECT id, source_entity_id, target_entity_id, relation, notes, created_at
      FROM relationships
      ORDER BY source_entity_id ASC, target_entity_id ASC, relation ASC
      """
    ).fetchall()
  finally:
    connection.close()

  payload = {
    "entities": [
      {
        "id": row[0],
        "type": row[1],
        "name": row[2],
        "description": row[3],
        "created_at": row[4],
        "updated_at": row[5],
      }
      for row in entity_rows
    ],
    "relationships": [
      {
        "id": row[0],
        "source_entity_id": row[1],
        "target_entity_id": row[2],
        "relation": row[3],
        "notes": row[4],
        "created_at": row[5],
      }
      for row in relationship_rows
    ],
  }

  snapshot_path = paths.root / "codex" / "codex.json"
  atomic_write_json(snapshot_path, payload)
  return snapshot_path


def _decode_text_file(path: Path) -> str:
  for encoding in ("utf-8", "utf-8-sig", "latin-1"):
    try:
      return path.read_text(encoding=encoding)
    except UnicodeDecodeError:
      continue
  raise OpenAuthorError(f"Unable to decode codex source file: {path}")


def _default_name_from_path(path: Path) -> str:
  return path.stem.replace("_", " ").replace("-", " ").strip() or path.name.strip()


def _coerce_entity_record(
  raw: Any,
  *,
  fallback_kind: str,
  fallback_name: str,
) -> tuple[str, str, str] | None:
  if raw is None:
    return None

  if isinstance(raw, str):
    name = fallback_name.strip()
    return (fallback_kind, name, raw.strip())

  if not isinstance(raw, dict):
    name = fallback_name.strip()
    return (fallback_kind, name, json.dumps(raw, ensure_ascii=False))

  raw_kind = str(raw.get("type") or raw.get("kind") or fallback_kind).strip().lower()
  kind = raw_kind if raw_kind in ENTITY_TYPES else fallback_kind
  name = str(raw.get("name") or fallback_name).strip()
  description_raw = raw.get(
    "description",
    raw.get("summary", raw.get("bio", raw.get("notes", ""))),
  )
  if isinstance(description_raw, str):
    description = description_raw.strip()
  else:
    description = json.dumps(description_raw, ensure_ascii=False)

  if not name:
    return None
  return (kind, name, description)


def _records_from_json_payload(
  payload: Any,
  *,
  fallback_kind: str,
  fallback_name: str,
) -> list[tuple[str, str, str]]:
  records: list[tuple[str, str, str]] = []

  if isinstance(payload, dict) and isinstance(payload.get("entities"), list):
    payload = payload["entities"]

  if isinstance(payload, list):
    for index, item in enumerate(payload):
      fallback = f"{fallback_name} {index + 1}".strip()
      record = _coerce_entity_record(
        item,
        fallback_kind=fallback_kind,
        fallback_name=fallback,
      )
      if record is not None:
        records.append(record)
    return records

  if isinstance(payload, dict) and (
    "name" not in payload and
    "description" not in payload and
    "summary" not in payload and
    "bio" not in payload
  ):
    all_string_values = all(isinstance(value, str) for value in payload.values())
    if all_string_values:
      for key, value in payload.items():
        record = _coerce_entity_record(
          {"name": str(key), "description": value},
          fallback_kind=fallback_kind,
          fallback_name=str(key),
        )
        if record is not None:
          records.append(record)
      return records

  record = _coerce_entity_record(
    payload,
    fallback_kind=fallback_kind,
    fallback_name=fallback_name,
  )
  if record is not None:
    records.append(record)
  return records


def _records_from_source_file(path: Path, kind: str) -> list[tuple[str, str, str]]:
  name = _default_name_from_path(path)
  if path.suffix.lower() == ".json":
    try:
      payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
      raise OpenAuthorError(f"Invalid codex JSON source at {path}.") from error
    return _records_from_json_payload(
      payload,
      fallback_kind=kind,
      fallback_name=name,
    )

  description = _decode_text_file(path).strip()
  if not description:
    return []
  return [(kind, name, description)]


def import_codex_from_directory(
  paths: ProjectPaths,
  source_root: Path,
) -> dict[str, Any]:
  ensure_codex(paths)
  root = source_root.resolve()
  if not root.exists() or not root.is_dir():
    return {
      "source": "folder",
      "imported": False,
      "entities": 0,
      "scanned_files": 0,
      "skipped_duplicates": 0,
      "detected_kinds": [],
    }

  kind_directories: list[tuple[str, Path]] = []
  seen_directories: set[Path] = set()
  for base in (root, root / "codex"):
    for directory_name, kind in CODEX_DIRECTORY_KIND_MAP.items():
      candidate = base / directory_name
      if not candidate.exists() or not candidate.is_dir():
        continue
      resolved = candidate.resolve()
      if resolved in seen_directories:
        continue
      seen_directories.add(resolved)
      kind_directories.append((kind, resolved))

  if not kind_directories:
    return {
      "source": "folder",
      "imported": False,
      "entities": 0,
      "scanned_files": 0,
      "skipped_duplicates": 0,
      "detected_kinds": [],
    }

  records: list[tuple[str, str, str]] = []
  scanned_files = 0
  allowed_suffixes = {".json", ".txt", ".md", ".markdown", ".rst", ".text"}
  detected_kinds = sorted({kind for kind, _ in kind_directories})
  for kind, directory in kind_directories:
    for path in sorted(directory.rglob("*")):
      if not path.is_file():
        continue
      if path.name.startswith("."):
        continue
      if path.suffix and path.suffix.lower() not in allowed_suffixes:
        continue
      scanned_files += 1
      records.extend(_records_from_source_file(path, kind))

  if not records:
    return {
      "source": "folder",
      "imported": False,
      "entities": 0,
      "scanned_files": scanned_files,
      "skipped_duplicates": 0,
      "detected_kinds": detected_kinds,
    }

  connection = sqlite3.connect(str(paths.codex_db))
  inserted = 0
  skipped_duplicates = 0
  now = utc_now()
  try:
    cursor = connection.cursor()
    existing_names = {
      row[0]
      for row in cursor.execute("SELECT name FROM entities").fetchall()
      if isinstance(row[0], str)
    }
    for kind, name, description in records:
      cleaned_name = name.strip()
      cleaned_description = description.strip()
      if not cleaned_name:
        continue
      if cleaned_name in existing_names:
        skipped_duplicates += 1
        continue
      entity_id = f"entity-{uuid.uuid4().hex[:12]}"
      cursor.execute(
        """
        INSERT INTO entities (id, kind, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (entity_id, kind, cleaned_name, cleaned_description, now, now),
      )
      existing_names.add(cleaned_name)
      inserted += 1
    connection.commit()
  finally:
    connection.close()

  if inserted > 0:
    export_codex_json(paths)

  return {
    "source": "folder",
    "imported": inserted > 0,
    "entities": inserted,
    "scanned_files": scanned_files,
    "skipped_duplicates": skipped_duplicates,
    "detected_kinds": detected_kinds,
  }
