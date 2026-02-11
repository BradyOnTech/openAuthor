from __future__ import annotations

import sqlite3
import uuid

from .project import OpenAuthorError, ProjectPaths, utc_now

ENTITY_TYPES = {"character", "location", "lore", "item", "faction", "event"}


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
  return entity_id


def list_entities(paths: ProjectPaths, *, kind: str | None = None) -> list[dict[str, str]]:
  ensure_codex(paths)
  connection = sqlite3.connect(str(paths.codex_db))
  try:
    cursor = connection.cursor()
    if kind:
      rows = cursor.execute(
        """
        SELECT id, kind, name, description, updated_at
        FROM entities
        WHERE kind = ?
        ORDER BY name ASC
        """,
        (kind,),
      ).fetchall()
    else:
      rows = cursor.execute(
        """
        SELECT id, kind, name, description, updated_at
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
      "updated_at": row[4],
    }
    for row in rows
  ]
