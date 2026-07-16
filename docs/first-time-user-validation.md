# First-time user and product validation

Date: 2026-07-15
Build: local macOS application bundle plus source-level workflow gates
Perspective: first-time serious fiction author, followed by SaaS/product-quality review

## Verdict

The active product now expresses the intended wedge: **safe revision of a complex novel**, not generic text generation. A first-time author can create or import a book, write and recover scenes, build evidence-backed Story Memory, generate and selectively review AI changes, undo them, explore a multi-scene Storyline, compare its narrative consequences, and return selected work to the trusted manuscript.

The implementation is product-complete for the development plan's single-author scope, but it is **not a public release candidate**. Developer ID signing, notarization evidence, x86_64 and arm64 clean-machine installation, forced-crash drills, and automated packaged-GUI execution remain release-certification gates.

## Flows exercised

- Clean first launch and creation of `The Clockwork Archive`
- Direct scene creation, editor opening, prose edit, save, close, and relaunch
- Local Change Set generation, side-by-side review, hunk exclusion and inclusion, apply, Revision creation, and one-click undo
- Author comment on a hunk followed by targeted regeneration
- Project brief, acts, chapters, scene beats, story-time metadata, labels, and structural move preview
- Story Memory scan, evidence review, correction before canon, bulk accept/defer/exclude, and evidence-backed Canon Fact creation
- Character Arc state and Canon diagnostics
- Storyline creation, edit isolation, semantic comparison, return to Primary, and selective integration preparation
- Coordinated AI generation across multiple selected scenes with atomic group application semantics
- Assistant conversation with Book scope, manuscript-grounded response, and promotion to a durable Story Memory suggestion
- Manuscript-wide search for prose and Story Memory
- Private, content-free local activation/trust dashboard
- Markdown/TXT/DOCX/Scrivener import contracts and Markdown/DOCX export contracts

The final packaged-bundle pass used macOS accessibility automation against the exact rebuilt `.app`, not a browser or development server. It verified semantic rail navigation and shortcuts, dashboard loading through the native command bridge, creation and saving of a second scene, one-instruction/two-scene coordinated generation, per-hunk comment revision, Story Memory correction plus bulk deferral, and persisted story-time/label metadata.

A second clean-room authoring pass created `The Lantern Cartographer` in a new local folder and deliberately exercised the smallest trust loop: create a truly blank scene, draft prose, observe dirty/save state, plan the book, return to the same sentence, edit scene metadata, request a focused final-paragraph revision, inspect the exact hunk, apply it, and undo it. That pass was repeated after each native fix against the rebuilt bundle. The final run produced `At midnight, the line reached her own door.` → `At midnight, the line found her own door.`, recorded before/apply/undo Revisions, restored the exact 44-word scene, and labeled the Change Set `undone`.

## Problems found and fixed

| Finding | User impact | Resolution |
| --- | --- | --- |
| Failed local initialization could leave a ghost recent project | First launch felt broken and hard to recover | Initialize the project before registering its local binding |
| A normal non-Git project surfaced `not a git repository` | Local-first promise looked false | Treat missing Git as expected; Git is only required for advanced Storylines |
| Status bar showed the folder slug instead of the book name | Identity felt inconsistent | Resolve the registered project name in the status bar |
| New scenes appeared in the tree but did not open | First action had no obvious result | Return the created scene from core/API and open it immediately |
| Deterministic local AI wrote instruction receipts into manuscript prose | Generated text was not publishable fiction | Replace the receipt with conservative, fact-preserving prose edits and regression tests |
| Packaged GUI sidecar probes could hang under AppKit | Assistant appeared to send forever | Use the spawn-safe launcher for every bundled Python probe and command |
| Packaged Assistant event streaming was blocked by Tauri ACL | Assistant failed after transport was repaired | Add explicit event listen/unlisten capability permissions |
| Book-scoped local Assistant lacked manuscript grounding without an index | Advice was generic | Add bounded first/last scene anchors, a compact scene index, and grounded local guidance |
| Successful saves could produce a false recovery warning | Authors could distrust save integrity | Normalize terminal newlines and keep the exact saved editor payload until refresh |
| Terminal newline differences produced a blank delete hunk | Review showed a meaningless change | Normalize terminal newline policy before Change Set diffing and persistence |
| Story Memory review lacked correction and true bulk control | Inference cleanup would become tedious | Add correction-before-canon plus bulk accept, review later, and exclude |
| Hunk review lacked conversational revision | Authors had to edit or regenerate blindly | Add a per-hunk comment and preserve that feedback in generation provenance |
| Plan lacked story time, labels, and consequence preview | Structural iteration was visually shallow | Add portable scene planning metadata and a non-mutating move-impact preview |
| Large Storyline ideas still required one-scene generation | The main differentiator stopped at comparison | Add coordinated multi-scene AI generation and atomic group apply semantics |
| Roadmap promised metrics without a privacy-safe implementation | Retention decisions would be opinion-led | Add a strict content-free allowlist, local-only event log, retention control, and dashboard; no external transport exists |
| Left-rail destinations were unlabeled clickable containers | VoiceOver and native automation could not identify or keyboard-focus the product's primary navigation | Replace them with named toggle buttons, visible focus treatment, accurate pressed state, and regression-safe styling |
| Plan, Storylines, and Settings advertised shortcuts that were missing or conflicting | Keyboard users could not trust the interface's own help text | Implement the routes, move Storylines to `Cmd+Shift+L`, make shortcut matching case-stable, and add the same destinations to the command palette |
| Packaged Settings rejected the new `metrics` command root | The private dashboard worked in source tests but failed in the shipped app boundary | Allowlist `metrics` in the native bridge, add a Rust regression test, rebuild, and re-run the dashboard in the bundle |
| A new project inherited tabs, center content, and the right panel from the previous novel | Authors could see another book's Plan or scene immediately after creating a novel | Scope the editor provider by project identity and reset shell panels on project changes |
| Rail navigation changed the left sidebar without reliably changing the center workspace | The app could say “Manuscript” while showing Plan | Centralize navigation ownership for the rail, shortcuts, command palette, and onboarding; Manuscript now returns to an open or first scene |
| Chat occupied a third of the window before the author asked for it | The blank-page experience felt like an IDE rather than a writing studio | Default the secondary panel closed, add an explicit Assistant rail control, and add a visible close button shared by Chat and Inspector |
| Scene titles were duplicated as Markdown headings inside prose | New scenes were not blank and title words polluted manuscript counts and diffs | Keep titles in front matter and the dedicated title field; new bodies contain prose only and the obsolete heading diagnostic was removed |
| Autosave was delayed and visually ambiguous | Authors could not tell whether recent writing was safe | Add sticky immediate word count plus Saved, Unsaved, and Saving states and retain crash-recovery journaling |
| Inspector spent width on read-only IDs and metadata | The panel had cost without authoring value | Make status, POV, and summary editable through partial updates that cannot overwrite the manuscript body |
| Unbound and duplicate registry records appeared as recent projects | Welcome looked corrupted even when local novels were healthy | Show only deduplicated, locally bound desktop recents while preserving registry data for safe recovery |
| Story Memory refresh timestamps created false Storyline merge conflicts | Derived bookkeeping appeared as competing narrative content | Preserve stable extraction timestamps and author corrections so equivalent inference results merge cleanly |
| The offline local provider returned a whitespace-only hunk for a focused request | The north-star loop claimed success without changing prose | Remove formatting-only fallback edits, reject unchanged drafts, target explicit ending hints, and regression-test the real `reached` → `found` review path |
| Applied Change Sets still appeared “applied” after a successful Undo | The history contradicted the restored manuscript | Derive an `undone` display state in the review and queue, with semantic keyboard-focusable Change Set and Revision rows |

## Product review and pushback

The strongest product is a **revision operating system for fiction**. Its differentiated loop is:

1. remember what the story says and cite it;
2. state a creative intent and protected constraints;
3. generate concrete, reviewable changes;
4. inspect prose and narrative consequences;
5. commit selected work as a named Revision;
6. explore a larger hypothesis as a Storyline;
7. learn from outcomes without corrupting the trusted manuscript.

That loop is now more valuable than copying competitors' blank-page generation, prompt libraries, model-control panels, or word-count gamification. Those features would make openAuthor look broader while making its reason to exist less clear.

Phase H should remain gated. Cloud sync, collaboration, hosted inference, mobile editing, and a marketplace should not start until design partners repeatedly complete the golden loop and retained manuscripts use both Story Memory and Storylines. When expansion is justified, collaboration should reuse Change Sets, Canon approval, Revisions, and Storyline integration rather than introducing a second review model.

The best near-term commercial shape is a local-first paid desktop product with optional inference/provider costs, followed by encrypted sync and editor collaboration only when retention proves demand. The private dashboard supports local product comprehension, but cohort retention and willingness-to-pay still require an explicit design-partner program.

## Remaining release-certification work

- Run the credentialed signing/notarization workflow and preserve Apple verification evidence.
- Install the signed artifacts on clean arm64 and x86_64 Macs with no developer tools.
- Automate the packaged GUI golden loop; current automation covers rendered React and the native Rust-to-core bridge separately.
- Run a forced-process-termination recovery drill on the signed bundle.
- Expand Canon and Editorial evaluation with licensed or design-partner manuscripts across genres and manuscript lengths.
- Validate comprehension and trust with serious authors; passing deterministic tests cannot establish creative usefulness by itself.

These are release and market-validation gates, not reasons to mislabel implemented product surfaces as missing.
