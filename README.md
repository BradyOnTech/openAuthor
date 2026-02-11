# openAuthor

Local-first fiction authoring foundation with:

- Git-native manuscript project structure
- Markdown scene files with metadata
- SQLite-backed codex entities
- Proposal queue for AI-assisted edits

## Quick start

```bash
make setup
make check
make test
```

## CLI usage

Run all commands with `python3 -m openauthor ...` (or install via `pip install -e .` and use `openauthor`).

```bash
# initialize in current folder
python3 -m openauthor init .

# add and list scenes
python3 -m openauthor scene add --title "Opening Scene" --summary "Introduce protagonist" --pov "Elara"
python3 -m openauthor scene list

# add and list codex entities
python3 -m openauthor codex add --type character --name "Elara" --description "Main POV character"
python3 -m openauthor codex list --type character

# create and apply proposal cards
python3 -m openauthor proposal add --title "Tighten prose" --instruction "Make paragraph one more direct" --scene scene-0001
python3 -m openauthor proposal list --status pending
python3 -m openauthor proposal apply --id proposal-xxxxxxxxxxxx

# create git snapshot
python3 -m openauthor snapshot create -m "Draft scene and codex seed"
python3 -m openauthor snapshot log
```

## Repository layout

```text
.
├── openauthor/             # core project engine + CLI
├── tests/                  # end-to-end CLI flow tests
├── manuscript/scenes/      # scene markdown files
├── codex/codex.sqlite3     # codex database (created on init)
├── .openauthor/            # project metadata + proposals
└── docs/                   # brief + implementation plan
```

## Status

Phase 0 and core Phase 1 scaffolding are complete. See `docs/plan.md`.
