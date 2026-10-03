# Current native recovery checkpoint

The normal and isolated local QA apps were built from `a5230979315e3e0dd665c5cae5b9af44fa399f93`. The normal app passes strict packaged-source/runtime verification and five instrumented packaged-engine crash stages. The alternate QA identifier was checked with the packaged-core verifier without the canonical app-identity option; its core fingerprint matches the normal app. Neither build establishes Developer ID signing or notarization.

Root used the actual QA GUI to review and apply three local-provider Change Sets together, undo all three, create a verified 41-file backup, and restore it into a new folder. Saved draft bodies and one shared apply Revision are retained. Undo restored all three whole scene files byte for byte, and recovery retained the same seven Revisions. Restore left the original book's scene files intact. The fixture was prepared with the earlier `ae3eb2e` bundle; its packaged core fingerprint matches this build exactly.

After those operations finished, root force-stopped only the independently identified QA app and its exact owned local serve processes. Relaunch through the retained trusted wrapper restored the selected review tab, Changes workspace, three undone proposals and seven Revisions. This is **post-operation restart** evidence. It does not establish actual GUI interruption during a transaction. A brief native Command Palette observation also checks its names, keyboard result selection and Escape focus restoration; exact-caret behavior is covered separately by rendered/browser checks.

[observations.json](observations.json) is a **manual root transcription** of live CUA accessibility text and inline screenshots. Native image files are not archived. Raw packaged-core outputs, fixture originals, archive, process guards and build logs are retained alongside it. The initial status assertion and process-guard setup corrections are documented. No production manuscript, live provider or deployment was used.

Generated scene originals are retained losslessly as `.md.gz` so their empty frontmatter values and exact bytes are preserved. The fixture's original hash manifest is checked against their decompressed bytes; no scene content was normalized for the commit.

Run `python3 docs/evaluations/keyboard-review-accessibility-2026-10-02/native/verify.py` to check retained hashes and correlations. `--seal` refreshes this subtree's own manifest. The parent verifier excludes this subtree. Neither verifier replays the GUI or certifies release readiness.

Real GUI mid-write interruption, VoiceOver, display scaling, long sessions, author editorial/Memory assessment, physical mobile/deployment acceptance and signed/notarized clean-machine recovery remain open. All six priorities stay in progress.
