# AppV2 Project Registry and RBAC

## Overview
- Project/workspace metadata and RBAC are defined in Supabase migration:
  - `supabase/migrations/20260225180000_project_registry_rbac.sql`
- AppV2 now opens projects by identity (`projectId`) and resolves local desktop folders through per-device bindings.
- Core project metadata now persists `project_id` in `.openauthor/project.json`.

## Desktop/Web Behavior
- Desktop:
  - Select workspace/project in AppV2.
  - Attach local folder path for the selected `projectId`.
  - App validates `.openauthor/project.json` and enforces `project_id` match.
- Web:
  - Registry/project management works without local filesystem attachment.
  - Local manuscript execution remains desktop-only.

## Environment
- Optional Supabase-backed registry mode:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- If both variables are missing, AppV2 uses local-storage registry fallback for development.

## CLI Additions
- `openauthor project inspect --json`
- `openauthor project ensure-id [--id <project_id>] --json`

These commands are used by AppV2 to migrate legacy project roots and enforce durable project identity.
