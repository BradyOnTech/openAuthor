# Writing accessibility — 2026-10-02

Status: bounded local repair at `96bd04d5d6392bb3de7c8a817cc0ee20cc0c70ab`;
the six project priorities remain in progress. Baseline:
`b080cef6f58ae1a1694d221b2827ea4747991f17`.

The live scene title and prose expose keyboard focus rings. Primary buttons,
placeholders, Unsaved status and secondary metadata have improved contrast.
Entering focus mode and leaving through Escape or Exit target the live prose,
including when the earlier Saved prose comparison is visible. The regression
types at the preserved mid-sentence caret without moving it to the end.

| Retained check | Result and scope |
| --- | --- |
| Corrected Chrome baseline | 2 failed; 11 sampled contrast failures and 4 missing-outline failures |
| Initial browser gates | Chrome 7/7 and WebKit 7/7, before the final conflict selector and exact-caret assertion |
| Final exact-caret gates | Chrome 2/2 and WebKit 2/2; repeats the two theme journeys from the seven, not nine unique journeys |
| Final desktop suite | 660 tests in 90 files; zero failed or skipped |
| Focused final workflow | 4 passed, 35 filtered; conflict entry, Escape, Exit click and ordinary draft |
| Build | Initial standalone build predates the final selector; retained final normal/local-flavor native builds include final TypeScript/Vite checks |
| Independent review | Spec's two issues repaired, zero open; Standards zero hard findings, one optional low suggestion |

Both final engines record solid 2px title/prose focus outlines, with computed
contrast 5.3943 in dark and 5.8077 in light. Sampled button, placeholder, Unsaved
and Plan text meet the test's 4.5 threshold. Plan measures the single “Story
architecture” label on the deep background; the title placeholder is a computed
pseudo-element sample while the title is populated. These settled appearances
disable CSS transitions. They establish the sampled browser results, not a
general WCAG or native accessibility certification.

## Provenance and retained failures

`results.json` identifies 17 original logs retained byte-for-byte as gzip, 14
browser JSON artifacts and 28 screenshots. The first run failed because the
default Chromium executable was absent. The next run used flawed color and
transition instrumentation; its measurements are retained separately and are
not baseline proof. The corrected baseline establishes the observed deficits.
The first conflict regression also had an incorrect entry-tab label; the next
confirmed red reaches all three focus assertions and selects Saved prose.

`tested-source.tar.gz` and `source-sha256.json` capture exactly the four changed
files and match the implementation commit. Other UI/core/native code, browser
fixtures, configuration and dependencies are outside this archive. Historical
run artifacts do not embed commit IDs; their baseline/final association follows
the root runner's recorded provenance. This is not a full archived-build or
clean-install certificate. `baseline/ZenMode.tsx` retains the Git baseline for
future replay intent. No replay was run from this packet; the confirmed red
used the intermediate generic-selector Escape repair absent from that baseline.

No application tests, browser sessions, network calls or UI interaction were
performed while assembling the original nonnative packet. The separately
verified [native packet](native/README.md) records a current normal copied-bundle
gate and limited light-theme GUI focus/caret/tab/Plan SIGKILL observations in a
separate local acceptance flavor. Full VoiceOver, signed clean-machine,
physical-device, deployed/provider and author acceptance remain open. Root's
native observations and hashes have a separate verifier.

## Verify

`python3 docs/evaluations/writing-accessibility-2026-10-02/verify.py` checks
declared artifact hashes, original log bytes, archive members, current source,
and Git commit associations. After an intentional packet-document update, root
can use `--seal` to refresh its artifact manifest and perform the same checks.
The separately owned `native/` directory is excluded from this verifier.
