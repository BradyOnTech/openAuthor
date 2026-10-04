# Empty outline round trips — October 2, 2026

Empty parts and chapters now survive manuscript export, preview and import without
creating empty scenes. Previously, both export formats included their headings,
but import rebuilt the Plan only from scenes with prose and silently discarded
the empty containers. An outline without any scenes could not be imported.

The shared resolver now retains ordered outline boundaries separately from prose.
Preview and commit consume that same result, including author role/title
corrections. Source/correction fingerprints still refuse stale import requests
before writing. Existing unassigned writing remains before appended outline and
prose. Import uses the existing durable book transaction and shared project lock.

Markdown uses the existing schema-1 `openauthor-manuscript.json`; old exports need
no migration. DOCX exports use ordinary named paragraph styles based on Word
heading styles to retain explicit part/chapter/scene roles, including arbitrary
empty titles and deliberately empty scenes. This is an openAuthor export/import
check; editing the document in Microsoft Word or LibreOffice was not tested.

The import review displays the complete resulting outline, labels empty parts
and chapters, keeps boundary corrections editable, and retains compatibility with
older previews containing only scene rows. Empty Scrivener folders are retained
as reviewed containers; a leaf folder's ambiguous part/chapter role is disclosed
and editable. Excluded Scrivener subtrees remain excluded.

Evidence:

- [roundtrip.json](roundtrip.json) records real CLI subprocesses for both public
  `manuscript export → preview → import` paths: 3 parts, 4 chapters and 1 scene;
  identical outline titles, parentage and order; identical scene-prose hashes;
  repeated spaces and Unicode in exported titles; unchanged original scene
  files; source hashes and explicit export loss reports.
  Reproduce with `python3 docs/evaluations/outline-roundtrip-2026-10-02/replay.py`.
- `tests/test_outline_roundtrip.py` covers 10 cases: populated/empty containers,
  outline-only books, existing prose, boundary corrections, stale empty-outline
  changes, deliberate empty scenes, ambiguous DOCX headings, Scrivener exclusion,
  disclosed flattening, and a real subprocess killed with SIGKILL after its Plan
  write. The next ordinary book read restores the exact prior Plan/prose/Revision
  HEAD, and retry imports successfully.
- [Focused core checks](core-checks.txt) passed 47 tests: the 13 manuscript IO
  tests, the 10 new outline tests, and existing durable transaction/concurrency
  checks. The old IO test
  checking Plan-ordered export had been hidden by a repeated test-class
  declaration; it is now collected and passes.
- [Rendered import preview and existing app workflow checks](desktop-checks.txt)
  passed 39 tests.
  TypeScript passed after the new import UI/type changes. This does not claim
  packaged native file-dialog or physical accessibility acceptance.
- A different agent independently reviewed the implementation and ran all 23
  IO/outline tests without finding a material ordering, parentage, correction or
  fingerprint defect.

Remaining format limits are visible in preview and export reports. Without a
Markdown manifest or retained DOCX section styles, roles must be inferred and
ambiguous empty headings can be omitted until the author corrects them. Files or
Single strategy flattens structure into prose; deeper nesting is represented by
the supported part/chapter hierarchy with a warning. Part/chapter synopses,
planning data, Memory/Canon, project history and other authoring artifacts require
a full backup. No provider calls, remote changes or user-book data were used.
