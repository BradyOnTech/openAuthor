# Author journey readiness

Updated 2026-09-11. Working product assessment, not a release certificate.

## Purpose

openAuthor is a private, local-first novel-writing studio. The author plans and
writes the book, discusses it with a manuscript-aware copilot, reviews proposed
changes, maintains story knowledge, explores alternate Storylines, and exports
their work. Suggestions are not canon, and proposals are not permission to change
the manuscript. Mobile is the companion: read, discuss by voice, capture ideas,
and send review intent back to desktop—not a second full manuscript editor.

## Functional assessment

“Browser verified” means the real Python engine behind the rendered web shell,
with only native transport adapted. It does not certify packaged Tauri, a physical
phone, or live-model quality.

| Author's job | Available now | Evidence and remaining gap |
| --- | --- | --- |
| Start a book | New project; previewed Markdown/TXT/DOCX/Scrivener import | Browser verifies heading-based Markdown import with unchanged source. Full format fidelity and packaged file dialogs remain open. |
| Plan and draft | Brief, acts/chapters, scene placement, beats, metadata, autosave, focus; chapter-aware navigation with title/chapter/POV filtering | Browser verifies planning, navigation in Plan order and actual save/focus/reopen. Planning-draft retention and long-session ergonomics need more work. |
| Read the book | New read-only chapter view, chapter navigation, direct return to editing | Browser verifies reordered prose; core includes unassigned scenes. Long chapters render at most 25 scenes per page. Persistent reading position remains an improvement. |
| Discuss and retain ideas | Scoped copilot, retrieval/citations, note/suggestion/experiment promotion; one-request Memory permission and context receipts | Browser verifies scene/chapter/character focus, regeneration, Memory permission, saving a note and the chapter/accepted-canon/Storyline receipt. Shared text/desktop-voice context includes brief, Plan order, relevant accepted facts and active experiment intent. Estimated assembled-input budgeting and oversized-request recovery are tested; exact provider token accounting, ongoing voice-session limits and novel-scale judgment remain gates. |
| Review revisions | Change Sets, hunk selection, coordinated apply/undo, revisions, conflict review | Browser verifies two distant scenes applied/restored together in a 64-scene workload, protected-text refusal, newer-writing refusal and stale-save reconciliation. Creative quality and multi-file crash recovery remain unproven. |
| Shape writing quality | Editable Writing Voice, original craft presets, review-first exemplar analysis, bounded sample comparisons and author assessments | Browser verifies approval, offline comparison/assessment/reopen, chat promotion and the approved voice receipt. Provider-seam tests verify analysis, creative candidates, exact Change Set handoff and apply/undo. Live prose quality and mobile profile projection remain open. |
| Manage story knowledge | Structured entries, temporal facts/relationships, evidence, suggestion review, diagnostics | Browser creates/edits an entry and finds it alongside prose. Rich canon workflows have core/rendered tests; usefulness on a substantial book remains unproven. |
| Explore alternatives | Storylines, comparison, selective integration into Changes | Browser exercises an original six-scene alternate ending, returns to Primary, integrates one of two changed scenes, verifies the other is unchanged and undoes. Clean scene tabs reload the active Storyline; comprehensive unsaved-navigation policy remains open. |
| Finish the book | Word and Markdown export with loss reports | Both now follow Plan order, with unassigned scenes last. Browser exports/re-reads Word; core checks both formats. Export remains scene-oriented, not a typesetting feature. |
| Work on mobile | Encrypted reading, offline capture, explicit sync, desktop inbox; Realtime voice paths | Existing companion browser/core checks plus 86 current mobile tests, including privacy filtering of older downloaded snapshots. Hosted delivery, physical iOS/Android voice, interruption/audio routing and native credential migration remain gates. |

## Connected author journey and reading

- Added the connected import → plan → read → Memory → search → copilot → note →
  export → reopen browser journey in `desktop/e2e/book-journey.spec.ts`.
- Fixed copilot artifact actions made unclickable by conflicting dropdown
  positioning. They now expand inline in the narrow sidebar.
- Fixed export ignoring chapter order. Reading and export share
  `planning.list_manuscript_scenes`; planning mutations/export use the project lock.
- Added reading from Manuscript and Plan, with pending-save checks and fresh scene
  loading when returning to edit.
- Finished the bounded recovery collision fix: independently owned browser slots,
  sequence-specific retirement, and a multiple-draft chooser. This is not complete
  disk/crash recovery.

## Alternate ending and daily navigation

- Added `desktop/e2e/storyline-journey.spec.ts` with an original six-scene,
  three-chapter fixture. It is a small connected creative exercise, not evidence
  of full-novel editorial quality. The provider remains offline/local.
- Fixed clean cached scene tabs retaining an old Storyline's edit version. The
  shared scene activation module reloads saved state before enabling editing;
  dirty tabs retain their original guarded-save baseline.
- Fixed Chapter copilot scope accidentally prepending an unrelated open scene.
  Explicit chapter membership now determines primary context. Empty chapter
  selection fails with a clear instruction instead of discussing another scene.
- Added the saved project brief/style guide to shared context. Its full content
  is accounted for or rejected by the input budget; it is not silently clipped.
- Added act/chapter navigation, chapter scene/word counts, collapse, current-scene
  highlighting and title/chapter/POV filtering. Unassigned scenes stay reachable;
  Plan-load errors provide a flat fallback and retry. The existing Plan remains
  the source of order, following the codebase-design skill's shared-interface
  guidance. Browser verification includes reverse-file ordering and filtering.

## Memory permission and usable scoped discussion

- A shared projection now enforces Memory visibility and excludes private notes
  for new context, generation and tool reads. Stale indexes cannot bypass current
  access. Legacy/changed voice preparation must be refreshed before connecting.
- Desktop chat provides one-request permission, preserves cancelled/failed
  questions and checks current access. The browser verifies allow, cancel,
  regeneration with new permission and later exclusion against the real engine.
- Chapter and Character regeneration preserve picker-selected context instead of
  relying only on mentions in the question. Scope selectors now occupy their own
  row, fixing a measured 27-pixel-wide character question box.
- Mobile search/context filters raw downloaded Memory at read time, retaining
  complete author-owned data locally. See [Memory context](memory-context.md) for
  the precise policy, evidence, transcript and offline-revocation limits.

## Next priorities

The September 11 [Writing Voice workflow](writing-voice.md) implements the author's
approved prose-quality feature. It separates book prose from copilot personality,
keeps analysis and sample selection review-first, and shares the approved profile
across desktop writing paths. Next evaluate original scenes for useful creative
outcomes, character distinction and preserved facts; offline baselines and
transport fixtures do not establish literary quality.

The [book-sized editorial workload](editorial-workload.md) now exercises 64 scenes
and 36,476 words with planted distant evidence, coordinated Changes and one-action
group undo. It exposed delayed composer initialization and stale proposal
reviews; those UI paths are corrected. The surrounding prose is generated from
repeated patterns, so this advances mechanical evidence, not full-novel judgment.

The September 11 undo checkpoint adds an affected-scene list, pending state and
immediate open-review updates. It blocks dirty scene tabs in the UI and checks
every saved scene under the project lock. A newer edit or partial prior undo
prevents the entire restore. Failure-injection tests cover scenes, proposal
records and Revision HEAD; durable crash recovery remains separate. Legacy
groups without recorded workspace/membership still use individual review.

The [desktop-connected mobile evaluation](research/desktop-connected-mobile.md)
verifies a T3 Code/Tailscale connection precedent and recommends a bounded local
bridge experiment while retaining offline capture. No remote service is exposed
and no architecture replacement is selected.

The author approved the next delivery sequence in
[Approved working direction](product-development-plan.md#approved-working-direction--2026-09-07).
It includes evaluating a running-desktop mobile connection as an option, without
replacing the companion scope or authorizing deployment/network exposure.

1. **Useful, trustworthy editorial context:** accepted canon, Storyline intent and
   Plan-ordered neighbors now reach chat, desktop voice preparation, proposal
   planning and whole-scene drafting. See [Editorial context](editorial-context.md)
   for source verification, the author-facing receipt and tested limits. Assembled
   input estimates now include tools, history and numeric response reserve, with
   later text rounds checked again. Next assess hunk/merge context, exercise the
   substantial-book journey and bring richer evidence to mobile without bypassing
   access. Do not equate estimates with exact provider billing or continuous voice
   limits, or certify provider-level privacy from selection tests.
2. **Substantial-book editorial loop:** extend the original fixture with deliberate
   continuity, pacing and voice problems; character context and multi-scene
   revisions. Judge useful outcomes and preserved facts, not successful requests.
   Alongside this, improve persistent reading position, finding/acting on notes
   and retained planning drafts before adding more standalone panels.
3. **Mobile companion delivery:** approved hosting and physical-device voice
   acceptance, including microphone denial, reconnect, interruptions and desktop
   handoff. Keep manuscript mutations desktop-reviewed.
4. **Production gates alongside those journeys:** crash recovery, remaining
   metadata-store races, accessibility/contrast, native credentials, bundled
   runtime, signing and clean-machine installation.

Each iteration should complete a useful author task, fix its important bugs, and
add features that remove demonstrated obstacles. Green micro-tests alone do not
establish a usable novel-writing application. See `production-readiness.md` for
verification limits and `voice-mobile-build-plan.md` for companion architecture.
