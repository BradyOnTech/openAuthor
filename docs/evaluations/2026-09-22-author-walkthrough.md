# Author-workflow walkthrough — 2026-09-22

## Outcome and scope

The existing desktop author journeys work in the browser shell, but exploratory
navigation and smaller-screen checks exposed concrete usability failures. This
pass fixes those failures using the existing views and storage; it adds no new
service, schema, provider, or manuscript-editing surface.

Method: Playwright-driven Chrome, screenshot inspection, disposable original
books, and the real Python engine behind an adapted native transport. The main
desktop journey now runs at 1024 × 768; other journeys use 1400 × 900. Mobile uses
phone-sized Chromium, including a 390 × 550 reading-navigation check. The hosted
companion test uses real crypto/IndexedDB and desktop publication/import with a
simulated HTTP backend. This was **not** a Computer-plugin/native-app walkthrough,
physical-phone test, production hosting test, or live-model evaluation. No private
manuscript or paid inference was used.

## Ranked findings and fixes

| Priority | Reproduced finding | Resolution and evidence |
| --- | --- | --- |
| High: lost work | Capture → type an unfinished passage → Scenes → Capture returned an empty field and reset the capture type. | Keep the passive capture view mounted within the open book. Text and type survive tab changes; successful saves clear the text. Browser regression failed twice before the fix and now passes. Leaving the book, signing out or removing the device asks before discarding a draft; leaving is blocked during a pending save. |
| Medium: interrupted reading | Read a scene → Capture → Scenes returned to the list instead of the selected scene. | Do not clear scene selection on unrelated tab switches. Keep the passive reader mounted so the scene and scroll offset survive. Changing scene still starts at the top. Small-height browser coverage verifies the retained offset. |
| Medium: unreadable desktop navigation | With multiple documents and both sidebars open, The Clocktower's tab label had only 13 pixels of width. | Tabs retain readable widths and overflow horizontally. The active tab is revealed on selection and bar resize. The connected laptop journey checks label width, viewport visibility and absence of page overflow. |
| Medium: hidden voice feedback | On a phone, expanded profile explanations pushed Status: idle out of the viewport even while Start voice remained visible. | Keep session status, errors and the audio-sharing notice beside voice controls. Put longer profile/context explanations behind an accessible expander; retain the selected scene, fact count and missing-source warning. Show the text composer once a session exists. The viewport regression failed before the fix and now passes. |
| Medium: missing accessible state | Browser assertions found no expanded state on the new context control, and no selected state on existing companion tabs. | Use the ARIA props supported by both installed native and web implementations. Browser checks verify expanded and selected states. This is not a complete accessibility audit. |

The diagnosing-bugs workflow guided reproduction before repair. The causes were
view-local state discarded on unmount, an explicit navigation reset, flex-shrunk
tabs, long explanations above essential voice feedback, and unsupported web
mapping of the old accessibility-state prop. No broad architecture rewrite was
needed. The new navigation cases are retained as regression tests.

## Author tasks exercised

- Create/import an original book; plan chapters, place scenes, add beats, read
  chapters, edit/save, search, export Word and reopen.
- Discuss selected manuscript context with the offline provider; save an idea,
  find it in Plan, and prepare a reviewable revision without changing prose.
- Review/apply/undo changes, refuse stale/protected writes, recover retained
  desktop drafts, inspect distant canon evidence, correct facts, and selectively
  integrate an alternate Storyline.
- Approve a Writing Voice, compare offline baselines, retain an author assessment
  and show the approved profile in the context receipt. These are mechanical
  checks, not evidence of literary quality.
- Unlock an encrypted companion book; follow Plan order; open the selected scene
  in Assistant; inspect/collapse context; refresh withdrawn facts; capture an
  idea; navigate away and return; save and cold-reopen the encrypted queue;
  reopen offline; upload and import for desktop review.
- Inject one failed local outbox insert. The error stays visible and the capture
  text survives; retry stores exactly one encrypted pending item, then the normal
  cold-reopen and desktop-import checks complete.

## Verification and repeatability

Final checks: 284 Python tests, 242 desktop tests, 96 mobile tests/typecheck,
11 desktop browser journeys and 5 mobile browser journeys pass. Desktop and PWA
production builds, repository checks and whitespace checks pass. Gateway/native
test suites were not rerun in this UI-focused pass.

Run from the appropriate package directory, setting
`OPENAUTHOR_BROWSER_EXECUTABLE` to a locally installed Chrome if needed:

```sh
# Repository root
make test
make check
git diff --check

# desktop/
npm test
npm run build
npm run test:e2e

# mobile/
npm run check
npm run build:web
npm run test:e2e
npm run test:e2e:hosted
```

The desktop book journey saves `scene-discussion.png` and `saved-notes.png`.
Mobile navigation saves `capture-after-navigation.png` and
`reading-after-navigation.png`; the encrypted journey saves
`compact-assistant.png`, `refreshed-story-facts.png` and capture/review images.
These are generated under each package's ignored `test-results` directory and
are replaced on subsequent runs. Screenshots were visually inspected, not merely
generated. The existing desktop build advisory about a chunk over 500 kB remains.

## Next work, in order

1. **Prove the actual companion delivery.** Choose/approve the connection setup
   before exposing a desktop service or deploying hosting. Then test on physical
   iOS/Android: microphone refusal, connection, interruptions, headphones, app
   backgrounding, network changes, capture and desktop review. Nothing here
   establishes real audio reliability or authorization for API spending.
2. **Judge useful writing.** Use original, non-templated scenes through the
   authorized subscription chat path only, or stay offline. Compare whether
   revisions improve prose while preserving character, facts and author intent.
   Existing synthetic book-scale and offline results do not answer this.
3. **Close recovery and delivery gates.** Crash/restart drills, backup restoration,
   native file dialogs/credentials, packaged installation and signed delivery.
4. **Target the remaining daily-use friction.** Unfinished mobile drafts and
   reading positions currently survive tab switches only within an open book,
   not reloads or process termination. Saving to the encrypted outbox is still
   required. Desktop secondary chat actions also look subdued at laptop size;
   measure contrast and do a full keyboard/screen-reader pass before a broad
   visual redesign. Native alert, touch keyboard and physical-device layout
   behavior remain unverified.

Defer richer mobile context, extra panels and a full phone editor until these
author-task outcomes identify a concrete need. Mobile voice still stops when
leaving Assistant; only passive reading/capture views are retained across tabs.
