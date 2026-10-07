# Story writing kit PR readiness

The three findings from the branch review are resolved. The follow-up standards and specification reviews found no remaining actionable defect in these fixes. The comparison base was `origin/main` at `48f57b7dcb82b7020fe0aaf010f854e17f3b2a69`; the fixes follow `ba15645c487eeaa0dd7a94e537b9340a0c5714c4` on `codex/story-writing-kit`.

**Author controls corrected**

Quoted-text drafts now build one independent hunk per changed quoted passage. Every combination of accepting and rejecting the two passages from the original corruption reproduction preserves narration and quote delimiters. Individual and coordinated application validate both the selected result and the saved manuscript. Quote-scoped writes retain terminal whitespace, and unsafe older sentence-based drafts are refused before application. Rebase retains decisions at unchanged quoted anchors, including repeated identical passages, without replacing matching narration.

Blank request overrides inherit saved direction before the effective permission is validated. Described story changes still require permission text in the resulting brief. The browser workflow saves that text, leaves the request description blank, and verifies that the inherited text reaches the plan and delivered draft.

Manual drafts retain the effective reviewed scene contract when delivered. Later saved-brief edits do not change regeneration or feedback context. Delivery replay retains the same draft and generation receipt. An explicitly retained empty contract also stays empty.

**Verification**

| Check | Result |
| --- | --- |
| Repository integrity and capability checks | Passed |
| Complete Python suite | 642 tests run; 641 passed, one skipped |
| Complete frontend suite | 728 tests in 96 files passed |
| TypeScript and desktop production build | Passed; existing chunk/import warnings remain |
| Desktop browser scenarios | All 38 distinct scenarios eventually passed across the initial run and bounded follow-up batches |
| Standards review of fixes | No remaining actionable finding |
| Specification review of fixes | No remaining actionable finding |

Regression workflows use real disposable book storage for draft delivery, partial acceptance, apply, coordinated apply, rebase, undo, retained briefs and delivery replay. Unsafe old hunks and manual quote-boundary escapes are refused without changing the book. A growth case verifies that the existing 120,000-character result allowance remains usable even when the source-to-candidate expansion exceeds 100,000 characters.

The browser authoring and book-sized coordinated revision scenarios use the real Python CLI through an adapted native transport. Other browser scenarios retain their existing test boundaries. This does not certify a rebuilt native app bundle or hosted services. No new paid provider call or literary-quality comparison was performed.

**Browser execution and resource handling**

The initially configured Playwright browser was absent, so checks used the installed Google Chrome executable. Browser failures exposed obsolete field selectors and an outdated word-target assertion; those assertions were corrected to match the current author-facing labels and rerun successfully.

The full browser run was interrupted after a reported memory-growth alert. Its Vite process was about 120 MiB RSS when inspected; the test server and browser processes were stopped, and the user reported a sharp memory drop. This snapshot does not establish a Vite leak or its cause.

Follow-up batches ran against the production build using `OPENAUTHOR_TEST_PREVIEW=1`, with one browser worker, an external 180-second deadline and a 384 MiB Vite RSS stop threshold. Observed preview-server peaks were 102.0, 98.5 and 99.2 MiB. Each batch shut down its server; port 4173 was verified closed afterward. The separate reading-comparison server on port 8861 was preserved.

To exercise the built application locally, build it with the same local-registry configuration first:

```sh
VITE_SUPABASE_URL='' VITE_SUPABASE_ANON_KEY='' VITE_PROJECT_REGISTRY=local npm --prefix desktop run build
cd desktop
OPENAUTHOR_TEST_PREVIEW=1 OPENAUTHOR_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e -- e2e/authoring.spec.ts
```

The earlier [writing comparison](writing-comparison-2026-10-06/assessment.md) remains the evidence for writing quality. These fixes establish inspectable direction and safe edit boundaries; they do not expand that comparison's literary claims.
