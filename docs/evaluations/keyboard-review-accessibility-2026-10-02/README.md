# Keyboard writing and Plan review checkpoint

Source `a5230979315e3e0dd665c5cae5b9af44fa399f93` passes 699 desktop tests in 91 files, TypeScript/Vite and 13 real-core offline browser journeys in each Chrome/WebKit engine (26 cases, no failures/skips/flakes). Six changed files and 356 broader inputs are retained in the source archive and correlated to that commit. The source snapshot timing is stated exactly in results.json; the rendered/build inputs match independent reviews before those checks.

Command Palette exposes selected-result semantics, contains Tab, returns exact writing selection on dismissal and fences delayed navigation without replacing unfinished tabs. Plan supports exact same/cross-chapter and inbox positions, retains drafts and useful keyboard focus, and refuses older preview replies.

Original rendered reds are retained: Palette four failures twice and final tests against baseline twelve failures/two existing controls; Plan missing exact position and reversed preview replies. Final focused suites are Palette14 and Plan16. Headless popup-arrow failures also reproduce on bare selects. True native typeahead, duplicate-prefix cycling and a measured1200ms buffer expiry drive the final Plan browser journey; no selectOption/value assignment stands in for keyboard navigation. The earlier selectOption batch is explicitly intermediate. Setup failures remain separate.

Independent Standards has zero hard violations and one optional low Data Clumps concern. Independent Spec has zero actionable findings. Four preexisting author artifacts are unchanged. No live provider call or deployment occurred. All six priorities remain in progress; native VoiceOver, sustained author use, physical devices and signed/clean-machine recovery are separate requirements.

The separately sealed [native checkpoint](native/README.md) records the current normal/QA builds, packaged-engine probes, three-scene GUI apply/byte-exact undo, verified backup/restore and restart after completed operations. Its GUI observations are manual root transcriptions, with raw packaged-core readback retained. Actual interruption during a GUI write, VoiceOver and signed clean-machine acceptance remain open.

Diagnostic scripts are retained losslessly as `.mjs.gz`; synthetic native scene originals use `.md.gz`. Compression preserves the executed scripts and generated scene bytes without reformatting their whitespace.

Run `python3 docs/evaluations/keyboard-review-accessibility-2026-10-02/verify.py --current` from the repository root. Without --current, the verifier checks historical archive/commit correlation. --seal intentionally refreshes the packet hash manifest. This verifies integrity and provenance; it does not rerun acceptance.
