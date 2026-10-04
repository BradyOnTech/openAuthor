# Executed flow catalogue

Generated from both final full-run reports. Each of the 79 rows passed once per aggregate.
Native collection is separate and is not included here.

| Runner / group | Flow | Chromium | WebKit |
| --- | --- | --- | --- |
| tester-army/e2e / backend | [backend: reviewed import refuses changed source and exports saved chapter prose](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: stale editor save preserves newer prose and its recoverable conflict](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: individual budget limits clear while unrelated limits remain enforced](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: malformed stored budget values fail safely without rewriting the policy](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: local proposal delivery is replay safe, reviewed before apply and undoable](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: named versions restore selected prose and portable backups recover a separate book](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: Storyline edits remain isolated and integrate through a reviewed Change Set](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: reviewed local chat context and retried delivery produce one durable exchange](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: persistent sidecar rejects invalid message limits and remains responsive](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: mobile snapshot and outbox replay preserve proposal review as the mutation boundary](../../../e2e/tests/backend-core.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: gateway health, origins and signed device authority reject invalid clients before allocation](../../../e2e/tests/backend-gateway.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: signed session creation clamps policy, durably registers, renews only its owner and acknowledges stop](../../../e2e/tests/backend-gateway.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: revocation and unrenewed expiry independently end known calls](../../../e2e/tests/backend-gateway.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: issuance quota limits retries without consuming another slot for renewal or stop](../../../e2e/tests/backend-gateway.e2e.ts) | passed | passed |
| tester-army/e2e / backend | [backend: upstream failure hides private bodies and malformed answers tear down the registered call](../../../e2e/tests/backend-gateway.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop writes and plans a book, reviews a revision, undoes it and refuses a stale save](../../../e2e/tests/desktop-authoring.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop preserves an unsent question after an Assistant module outage and requires fresh review to recover](../../../e2e/tests/desktop-chat-module-recovery.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop promotes permission-reviewed Assistant replies into notes, reviewed Memory, a Storyline, Writing Voice and a Change Set](../../../e2e/tests/desktop-chat-promotions.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop keyboard budget controls clear one limit, enforce generation and account for usage](../../../e2e/tests/desktop-controls.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop saves a custom Editorial Pass, controls Style Profile sources and chooses a reviewed creative direction](../../../e2e/tests/desktop-controls.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop previews and imports markdown, reads exact prose and exports Markdown in the same order](../../../e2e/tests/desktop-interchange.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop previews and imports text, reads exact prose and exports Markdown in the same order](../../../e2e/tests/desktop-interchange.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop previews and imports docx, reads exact prose and exports Markdown in the same order](../../../e2e/tests/desktop-interchange.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop previews and imports scrivener, reads exact prose and exports Markdown in the same order](../../../e2e/tests/desktop-interchange.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop branches a Storyline, reviews a conflict and merges the approved reconciliation](../../../e2e/tests/desktop-merge.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop records a private golden loop, pauses collection and keeps saved signals content-free](../../../e2e/tests/desktop-product-signals.e2e.ts) | passed | passed |
| tester-army/e2e / desktop | [desktop repairs missing workspace storage and restores a verified backup without overwriting another book](../../../e2e/tests/desktop-recovery.e2e.ts) | passed | passed |
| tester-army/e2e / mobile | [mobile reader searches prose, handles no results and preserves its scene across tabs](../../../e2e/tests/mobile-companion.e2e.ts) | passed | passed |
| tester-army/e2e / mobile | [mobile captures every review kind and retains saved items after ordinary sign-out](../../../e2e/tests/mobile-companion.e2e.ts) | passed | passed |
| tester-army/e2e / mobile | [mobile protects an unfinished capture when leaving a book or signing out](../../../e2e/tests/mobile-companion.e2e.ts) | passed | passed |
| tester-army/e2e / mobile | [mobile preview refuses voice, upload and recovery without contacting hosting](../../../e2e/tests/mobile-companion.e2e.ts) | passed | passed |
| tester-army/e2e / mobile | [mobile device removal requires confirmation and clears its sample review queue](../../../e2e/tests/mobile-companion.e2e.ts) | passed | passed |
| tester-army/e2e / mobile | [mobile preview clearly resets sample captures after a cold reload](../../../e2e/tests/mobile-companion.e2e.ts) | passed | passed |
| tester-army/e2e / database | [database authorization, key recovery, deletion, voice leases and shared quota survive concurrency](../../../e2e/tests/backend-database.e2e.ts) | passed | passed |
| Playwright / desktop/test:e2e | [reviews exact scope at laptop size and resolves a lost request through owned status after device revocation](../../../desktop/e2e/account-deletion.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [sign-out redacts reviewed history and ignores a late begin reply](../../../desktop/e2e/account-deletion.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [connects and reviews an account with no hosted books through durable account-only enrollment](../../../desktop/e2e/account-deletion.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [reviews changed retained scope after device revocation and confirms a lost correction only by exact receipt](../../../desktop/e2e/account-deletion.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [requires a fresh scope review after explicit stale refusal and redacts a late correction on sign-out](../../../desktop/e2e/account-deletion.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [preserves an account-only enrolled client through reviewed deletion and lost amendment receipt recovery](../../../desktop/e2e/account-deletion.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [writes, focuses, reviews an AI revision, undoes it, and reopens the saved manuscript](../../../desktop/e2e/authoring.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [imports a book, plans chapters, saves Memory, discusses a scene, and exports readable prose](../../../desktop/e2e/book-journey.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [recovers Canon assertion corrections after navigation and restart without silently replacing a stale fact](../../../desktop/e2e/canon-correction-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [keyboard focus resumes a saved caret after restart while pointer placement remains authoritative](../../../desktop/e2e/caret-keyboard.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [keeps document tabs usable while preparing a Change Set](../../../desktop/e2e/change-set-navigation.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [re-reviews stale pending Memory context with fresh permission and a durable question](../../../desktop/e2e/chat-delivery-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [recovers a completed reply after transport loss without re-sending changed context](../../../desktop/e2e/chat-delivery-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [restores an absent envelope via authenticated snapshot proof and exact lost-reply reconciliation before explicit publication](../../../desktop/e2e/companion-key-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [same-account sign-in during pending proof fences the old session and restores deliberate reconnect](../../../desktop/e2e/companion-key-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [an indeterminate installation stays locked until deliberate reconnect independently unseals its committed envelope](../../../desktop/e2e/companion-key-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [authenticates an immutable key verifier before any snapshot, refuses another valid key and confirms a lost self-envelope reply](../../../desktop/e2e/companion-key-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [keeps no-snapshot verifier recovery locked when a new same-account session arrives during proof](../../../desktop/e2e/companion-key-recovery.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [reviews trusted device revocation and guarded rotation without leaking pending outcomes across books](../../../desktop/e2e/companion-trusted-devices.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [keeps an oversized chapter question and retries with complete scene context](../../../desktop/e2e/context-budget.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [coordinated undo refuses newer writing without changing another scene](../../../desktop/e2e/coordinated-undo-guard.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [keeps saved planning compact, recovers edits, and exposes passage actions beside long context](../../../desktop/e2e/daily-review-polish.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [dark writing controls expose keyboard focus and readable text](../../../desktop/e2e/editor-accessibility.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [light writing controls expose keyboard focus and readable text](../../../desktop/e2e/editor-accessibility.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [restores tabs and caret and reviews current evidence in a wide workspace](../../../desktop/e2e/editorial-workspace.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [Command Palette announces selection, contains focus and resumes exact prose](../../../desktop/e2e/keyboard-review-workspace.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [Plan keyboard positions persist within chapters, across chapters and in the inbox](../../../desktop/e2e/keyboard-review-workspace.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [reviews distant evidence and keeps coordinated revisions usable in a book-sized project](../../../desktop/e2e/long-book-journey.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [asks for Memory once, retains a cancelled question, and honors a later exclusion](../../../desktop/e2e/memory-permission.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [scans cold Memory, reviews evidence, corrects a type, refuses stale decisions, and reopens review history](../../../desktop/e2e/memory-review-workspace.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [reviews exact Memory scan sources on a laptop before queuing local suggestions, with stale and busy guards](../../../desktop/e2e/memory-semantic-scan.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [restores the selected activity beside recovered document tabs with a cached project ID](../../../desktop/e2e/session-continuity.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [restores the selected activity beside recovered document tabs without a cached project ID](../../../desktop/e2e/session-continuity.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [recovers Plan text, reading position and an unfinished voice assessment after reload](../../../desktop/e2e/session-continuity.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [a clean open scene follows the active Storyline before the author resumes writing](../../../desktop/e2e/storyline-journey.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [explores an alternate ending, keeps chapter context, and integrates only the selected scene](../../../desktop/e2e/storyline-journey.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [keyboard tabs preserve writing, defer activation and retain focus after closing](../../../desktop/e2e/tab-keyboard.spec.ts) | passed | passed |
| Playwright / desktop/test:e2e | [approves an original Writing Voice, compares baselines and supplies the profile to copilot](../../../desktop/e2e/writing-voice.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e | [keeps an unfinished capture when checking the manuscript](../../../mobile/e2e/companion.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e | [returns to the same scene after capturing an idea](../../../mobile/e2e/companion.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e | [warns before leaving a book or signing out with an unfinished capture](../../../mobile/e2e/companion.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e | [phone companion reads a scene, keeps preview honest, and reopens its shell offline](../../../mobile/e2e/companion.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e:hosted | [a new phone retries enrollment, unlocks a desktop book and returns encrypted capture for review](../../../mobile/e2e/hosted-companion.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e:hosted | [an enrolled phone verifies its selected book before any snapshot exists](../../../mobile/e2e/hosted-companion.spec.ts) | passed | passed |
| Playwright / mobile/test:e2e:hosted | [finishing the project list does not move a downloaded-library press onto sign-out](../../../mobile/e2e/hosted-companion.spec.ts) | passed | passed |
