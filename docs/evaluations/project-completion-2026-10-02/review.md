# Project quality pass — 2026-10-02

Status: **in progress**. The latest implementation is `8aaf17d`; all six
acceptance priorities remain open. The [requirements ledger](requirements.json)
separates current results from historical checkpoints and required author,
device, deployment and distribution outcomes.

## Latest repairs and evidence

Current verifier-based recovery works before the first snapshot for newly
provisioned keys. Mobile candidate and explicit authorization writes now roll
back after late SDK identity replacement, while the App redacts recovery material
and preserves deliberately selected offline eligibility. Legacy keys without any
independent witness still cannot be proven; rotation restores future access only.
Journaled exact voice IDs now recover before SQL attachment through independent
accepted closure. Unknown pre-Location/pre-journal allocation and complete control
outages remain explicit limits.

The [current integration](../no-snapshot-recovery-integration-2026-10-02/README.md)
passes 657 desktop tests / 90 files,22 contracts,100 gateway/no skips,10 SQL suites,
37 aggregate controls and 11 journeys in each desktop browser. All 364 captured
inputs match committed source. The
[mobile packet](../../../mobile/evidence/2026-10-02-no-snapshot-recovery/README.md)
passes 243 tests / 34 files, two Chrome App journeys and one selected WebKit
recovery/redaction journey on the same built bundle; 150 inputs unchanged and 42
hashes verified. Both review axes have zero open findings after two mobile
repairs. These results do not establish physical native crypto/storage, approved
deployment, signed/native GUI, fresh-author judgment or release readiness.
Current mobile platform exports cover web; older iOS/Android/native results
retain their original checkpoint scopes.

The earlier cloud and account paragraphs below retain their `e7712d3` and
`9d31cf8` evidence scopes.

The reviewed multi-project account lifecycle now captures exact dispositions,
acknowledges retained shared history, freezes authority and composes separately
attested project cleanup. Desktop review lists devices and earlier deletion jobs,
supports accounts without a published book, and blocks cloud actions while a
begin reply is unresolved. Same-session refocus retains the reviewed request.
See the [account packet](../account-deletion-2026-10-02/README.md) and
[desktop packet](../desktop-account-deletion-2026-10-02/README.md).

An independent controller now registers known voice calls durably before answer
delivery and verifies their original scope, credentials and deadlines. Restart
and gateway-loss controls pass while a controller and provider control path remain
available. Account finalization blocks unresolved voice cleanup. Closed receipts
survive Auth redaction without reopening an active call. Unknown allocation and
complete control outages remain limits. See the
[controller packet](../independent-voice-control-2026-10-02/README.md).

Workspace bootstrap preserves existing membership roles and refuses cross-author
legacy takeover. Current registry RLS avoids recursive member queries and checks
live unfrozen membership. The
[combined checkpoint](../cloud-lifecycle-integration-2026-10-02/README.md)
records eight SQL suites, 16 actual concurrency controls and 94/94 gateway tests
without skips. Source hashes were unchanged across the final run. Independent
Standards and Spec re-reviews have zero open findings; 240 packet hash checks
matched, and the account raw log is preserved under a tracked compressed name.

Reviewed retained-project corrections now reconcile moves and exact independently
finalized deletions after account freeze. Original destructive choices and key
rotation thresholds remain intact; corrections invalidate prior cleanup approval.
Desktop selection and confirmation bind a fresh review and exact amendment UUID.
Lost replies resolve through the bare durable receipt before current progress,
including for accounts enrolled without a hosted book. Malformed error replies
remain unresolved. The [amendment integration packet](../account-amendment-integration-2026-10-02/README.md)
records 626 desktop tests, nine journeys per browser, nine SQL suites and
24 concurrency/isolation controls alongside 94/94 gateway tests without skips.
All 83 captured inputs remained unchanged and match the implementation commit.
Standards and Spec re-reviews have zero open findings; the two initial Spec
findings have failing regression controls and passing final coverage.

The earlier cloud checkpoint above retains its `e7712d3` scope. The writing,
Memory, tab and mobile-build work below belongs to the preceding
`0cd77bd` iteration; its unchanged core/mobile/native results retain that scope.

Writing Voice can now receive exact author-defined facts, knowledge limits,
uncertainty, protected wording and ending constraints. Source-bound fingerprints
and immutable local receipts preserve these through refinement and staging.
Missing literal protected text blocks staging. Consistency self-review needs exact original
and candidate excerpts; unverifiable candidate-only consistency praise is withheld. Desktop
constraint/profile/refinement drafts remain scoped to the original book,
Storyline and loaded version during late completions. The
[preservation packet](../voice-preservation-2026-10-02/README.md) replays retained
provider output and checks actual generation inputs without another live call.
Those outputs remain unchanged; better prose and semantic fidelity are unproven.

Local Memory fact extraction now withholds recognized dialogue, questions,
conditional/speculative statements and reported claims, including suffix
attribution. Exact Unicode source positions survive masking; accepted names
such as Maybe and Hope remain usable. The
[assertion corpus](../memory-assertions-2026-10-02/review.md) passes 31/31 authored
cases with zero extras or omissions, compared with 7/31 at the baseline. The
separate name corpus remains 25/27, with two uncased-name misses and two
person/place errors. The bounded English grammar conservatively withholds some
indirect affirmative claims and does not cover arbitrary attribution or all
languages. Fresh-prose author workload remains unmeasured.

Document tabs now have roving keyboard focus, arrow/Home/End navigation,
Enter/Space activation, reachable close buttons and named panels. Closing a
keyboard-focused workspace focuses a remaining neighbor. Browser workflows
preserve exact prose and restore selected documents. The
[tab packet](../tab-keyboard-2026-10-02/README.md) includes failing baseline
controls and current Chromium/WebKit evidence. The
[actual Mac observations](native-gui-0cd77bd.json) confirm focus/activation/close
behavior, saved synthetic prose and recovered Plan drafts on normal reopening.
This does not repeat the earlier caret/SIGKILL GUI drill or certify VoiceOver.

Mobile export commands now resolve the installed production configuration
offline, refuse signing/EAS fields and inspect actual web/iOS/Android Metro maps
for affected Forge/signing modules before removing public maps and generating
PWA caches. Fourteen new controls and actual export/web/hosted-test commands
pass. The [containment packet](../mobile-build-security-2026-10-02/README.md)
keeps the mandatory audit failing: five high entries still derive from one
unpatched advisory. Direct Expo commands can bypass the wrapper. A supported
patch or reviewed replacement plus configured signing/artifact acceptance is
still required; current unused-export containment does not clear that gate.

## Current verification

| Scope | Result | Limit |
| --- | --- | --- |
| Desktop | Current 657 tests in 90 files; TypeScript and production build pass | Frontend build; current native account/Keychain acceptance is unobserved |
| Account/key-recovery browser workflows | Current 11/11 Chromium and 11/11 WebKit, no skip | Production UI with synthetic SDK, vault and RPC boundaries |
| Gateway/database | Current 100/100, no skip; TypeScript/build; ten SQL suites and 37 concurrency/isolation controls | Disposable PostgreSQL/HTTP fixture; nine real database/process voice cases |
| Python 3.13 | Prior 0cd77bd: 577/577, no skip | Unchanged core; not rerun this iteration |
| Actual bundled Python 3.11.15 | Prior 0cd77bd: 577/577, no skip | Interpreter runs overlap; not rerun this iteration |
| Writing browser workflows | Prior 0cd77bd: 6/6 Chromium and 6/6 WebKit | Separate focused offline workflows; not current account journeys |
| Mobile | Current 243 tests in 34 files, TypeScript and guarded web App build; Chrome 2/2 full journeys and WebKit 1/1 selected recovery/redaction | Native storage uses mocks; prior 0cd77bd iOS/Android exports retain their scope; no physical phones or deployed acceptance |
| Native arm64 app | Prior 0cd77bd: exact core, runtime contract and five packaged-engine SIGKILL stages | Unsigned development app; no current frontend or clean-machine certificate |
| Independent review | Current zero open Standards or Spec findings | Local implementation review, not release acceptance |

The earlier [bundle report](native-bundle-0cd77bd.json) records clean tracked source,
core SHA-256 `671420d5d65908b138f523716518b842d755671ed009c221943be8ce978d9440`
and application SHA-256
`f1eec08b99af7bb1b2e78948fbc0aedfb13fb88c31065c201747d90598791ed4`.
The optimized build succeeded despite the existing Vite bundle advisories and
an optional debug-stripping warning caused by the local missing libLLVM library.
Exact raw build/check output is retained beside normalized display logs.

Native reopening retained the writing and Plan tabs, exact 26-word disposable
scene, unfinished Synopsis and new-act title. No manuscript/Plan save, Memory
decision or provider request occurred. Earlier backup, caret insertion and
forced native termination observations keep their distinct app identities.

## Earlier implementation, still relevant

Focused chapter/passage critique validates source quotations, reports uncertainty
and cannot be applied as prose. One synthetic connected chapter subscription
review caught a planted unexplained-knowledge concern. A unique-quote correction
recovered its inaccurate offset without another call. See the
[editorial assessment](../connected-editorial-2026-10-02/assessment.md).

Memory's evidence workspace supports retained corrections, reviewed semantic
scanning, explicit uncertain types and guarded Canon edits. Durable manuscript
transactions recover under the shared lock after real process kills; unknown
newer writing requires reviewed resolution. Noncooperating writers and physical
power loss remain explicit limits.

The companion's encrypted recovery, live Auth-session authority, renewable voice
leases and trusted-device review have local checks. The
[key-recovery packet](../book-key-recovery-2026-10-02/README.md) authenticates a
current committed snapshot before installing the desktop's missing envelope.
Without that snapshot or an independently verified current key, recovery stays
refused; a deliberate new rotation or future project-bound commitment is needed.

The [project-deletion packet](../project-deletion-2026-10-02/README.md) records
permanent namespace tombstones, leased orphan-inclusive cleanup, exact pending
intent and a separate verifier role. Target backing versions, upload queues and
in-flight upload absence must be independently checked before finalization.
The local HTTP fixture represents metadata, not physical backend purge.
Multi-project account orchestration is now implemented and locally verified.
Actual backing purge and Auth acceptance remain deployment gates. Reviewed
retention amendments now cover exact moves and independently finalized deletions.
Unknown absence without a permanent attested deletion receipt still requires
operator evidence and cannot be inferred from empty metadata.

## Remaining work

1. Author assessment of connected editorial and Writing Voice work: omissions,
   false alarms, factual/knowledge inventions, protected ambiguity and useful
   retained/rejected edits. The three existing Voice calls exposed a departure
   ambiguity; prepared refinement remains unrun after the input repair.
2. Fresh original-prose Memory evaluation and observed triage time, including
   uncased names, classification and indirect/ambiguous claims.
3. Long writing/review sessions, full native accessibility and signed multi-scene
   GUI crash/restore acceptance.
4. Approved deployed reading, encrypted capture, voice interruption/reconnect,
   cold restart and desktop handoff on physical iPhone and Android.
5. Deployed verifier recovery, legacy keys without an independent witness,
   unknown pre-Location/pre-journal allocation and target backing/queue
   verification, including operator evidence for unknown absent projects. Drill
   deployed authorization/revocation/rotation, independent controller operations
   and deletion. Complete control outages and provider media/billing cleanup
   retain their explicit limits.
6. Supported mobile dependency repair, Developer ID signing/notarization, clean
   Apple Silicon and Intel installation/upgrades, and signed credential checks.

The [latest dependency recheck](../mobile-dependency-recheck-2026-10-02/README.md)
still reports five high entries from one unpatched advisory and found no
supported released remedy in the inspected official packages. No dependency or
signing setting was changed; existing export containment does not clear the gate.

No valid signing identities are available locally. Current tooling has only
CommandLineTools and cannot use devicectl or adb; this is not proof that no user
phones exist. Resource/deployment questions remain pending.

One additional synthetic Writing Voice refinement request awaits approval.
Automatic approval review rejected the fourth call beyond the three-call
allowance. No human approval or new provider call was observed in this iteration.

Passing tests, retained fixtures and an unsigned local app cannot substitute for
these author, deployed, physical-device and signed distribution outcomes.
