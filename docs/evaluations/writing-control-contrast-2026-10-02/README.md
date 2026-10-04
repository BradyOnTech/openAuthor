# Writing control contrast evidence · 2026-10-02

The final sampled browser and desktop gates pass at commit `ae3eb2e44b6075c13fe1aade046b63f2dc47d8b0`: 677 desktop tests in 90 files, `tsc && vite build`, and eleven browser cases in each of Chromium and WebKit. Both themes in both engines pass all twenty-five contrast/focus observations. Three selected contrast files are archived and verified against current and committed source. Native acceptance is separate and unclaimed. Packet assembly performed no tests, builds, provider/network calls or UI/native actions. A separate read-only review verified the retained source, measurements and logs with zero open packet findings.

## Retained runs

Historical rows describe the scope at that checkpoint; their pending follow-up statements are resolved only by the later final rows, without changing the earlier result.

| Run | Recorded result | Interpretation |
| --- | --- | --- |
| `chrome-initial-fixture-attempt` | Two themed journeys failed; separate navigation journey passed | Command-palette animation was measured prematurely and the New thread role selector was incorrect. Partial shared-input measurements are retained; these palette measurements are not the settled baseline. |
| `chrome-corrected-baseline` | Two themed journeys failed eight contrast assertions: five dark, three light | Corrected fixture completed all thirteen sampled observations per theme. No fixture failure was reported. |
| `chrome-local-draft-fixture-attempt` | Two themed journeys failed; separate navigation journey passed | Each theme reached sixteen passing observations, then the deterministic local draft produced no prose change. Proposal-review samples were not reached. This is a fixture failure, not a passing complete contrast journey. |
| `chrome-expanded-controls-partial-final` | Two themed journeys passed; twenty-five observations each | A local draft fixture with an actual prose change reached gradient and proposal-review samples. This precedes the final explicit Comment-enabled assertion and navigation hydration changes. It is not acceptance of the forthcoming frozen source. |
| `chrome-frozen-contrast-intermediate-batch` | Expanded contrast cases passed with twenty-five observations each; wider batch ten passed, one failed | The contrast cases include the final explicit Comment-enabled assertion. An obsolete WritingVoice recovery-click fixture fails in the wider batch. The strengthened restored-tab/Assistant fixture and navigation follow-up are pending another run; the batch is not final all-pass evidence. |
| `final-chromium` | Eleven browser cases passed, including both twenty-five-observation theme cases | Completed final Comment-enabled assertion, direct WritingVoice restoration fixture and final navigation fences. Root reports exit code 0. |
| `final-webkit` | Eleven browser cases passed, including both twenty-five-observation theme cases | Same frozen selected contrast source and final wider case selection. Root reports exit code 0. |

The final runs contain eleven case executions per engine, including two theme cases of one contrast journey; this is not a claim of eleven distinct author workflows. The earlier eight-failure baseline, fixture failures and ten-pass/one-failure intermediate remain intact. The later final result does not change their historical outcomes. Final desktop/build logs are retained alongside browser logs, including their original warnings.

Raw logs are stored in `logs/` as gzip files. Decompression reproduces the original bytes; `results.json` records their sizes and SHA-256 hashes. `browser/` retains generated appearance JSON, PNGs and failure-context Markdown, including failed attempts. Trace ZIPs were not copied into this bounded packet. No writing PNG was generated before the initial selector failure; the available navigation screenshot is retained instead.

## Actual settled baseline and later Chromium measurements

| Sample | Dark baseline | Light baseline | Later dark | Later light |
| --- | ---: | ---: | ---: | ---: |
| New scene placeholder | 1.572 | 1.464 | 6.064 | 5.275 |
| Command palette placeholder | 1.305 | 1.807 | 5.036 | 6.510 |
| Enabled Send label | 3.989 | 5.753 | 4.725 | 5.753 |
| Hovered enabled Send label | 3.242 | 4.586 | 5.814 | 4.586 |
| Unfocused Exit focus mode | 3.210 | 3.309 | 5.354 | 5.622 |

Ratios come from retained actual-browser appearance JSON; the sampled ordinary text threshold is 4.5:1. Both runs also check title/prose keyboard focus, keyboard Escape/caret insertion and local saves. The later run adds visible empty Plan and excluded-hunk comment placeholders, Inspector/Revision History headings, Connection Map gradient bounds, included/excluded hunk controls, status labels and enabled Apply hover. The subsequent frozen contrast cases reproduce these measurements with an explicit assertion that Comment is enabled. The gradient measurement conservatively bounds the existing radial gradient; it does not claim a pixel-specific ratio at every graph position. Disabled button contrast is not claimed as ordinary enabled text contrast.

The corrected baseline test differs from the broader later gradient/review test. Its exact executed test source was not archived. `source/baseline/` contains only the two production files from commit `4a27acdac2ba2c6f87171c86dd9b3bab691f81f2`, verified against that Git object. A later final test snapshot must not be represented as the baseline test. Earlier gradient/review failures were source-calculated; this packet does not relabel them as actual-browser baseline failures.

`tested-source.tar.gz` and `source/final/` preserve the root-declared frozen CSS, ProposalReview and editor-accessibility test. `source-sha256.json` records their unchanged hashes and implementation commit `ae3eb2e44b6075c13fe1aade046b63f2dc47d8b0`. This selected archive is not a snapshot of every input to the wider eleven-test batch or desktop suite. Root reports 354 broader tracked inputs, including eight directly changed/frozen files unchanged across final runs; their broader archive is owned by the separate [navigation evaluation](../navigation-restoration-2026-10-02/README.md). This contrast verifier checks only its three selected source inputs, without claiming independent verification of that broader freeze.

## Action and acceptance limits

Within the contrast journeys, Send and Apply were enabled/hover-measured, never clicked. Regenerate and live providers were not invoked by those journeys. The synthetic review fixture used the offline deterministic provider, toggled hunk inclusion and opened the comment input; the passing journey asserts that the saved review scene remains unchanged. Creating/saving the synthetic writing scene is part of the journey, so this is not a claim of zero manuscript operations. Other screenshots retained from the wider intermediate batch do not extend these contrast-specific action claims to every batch case.

These are sampled browser controls and themes, not universal WCAG/accessibility certification, native GUI acceptance, signed distribution, release acceptance, physical-device evidence or clean-machine evidence. Earlier separate navigation passes belong to their recorded source; the final browser runs include the completed follow-up. Broader navigation evidence, current native work and independent packet review remain separately owned. Their scopes are explicit in `results.json`.

## Integrity

Run `python3 docs/evaluations/writing-control-contrast-2026-10-02/verify.py` to verify retained hashes, decompressed logs, browser artifacts, baseline source objects, archived/current/committed selected source equality, derived observation summaries and completed final log summaries. Verification is read-only and does not run application tests. After intentional packet updates, use `--seal` to refresh `evidence-sha256.json`, then obtain a separate review; sealing is an integrity operation, not independent acceptance.

The forthcoming `native/` subpacket, if added, is excluded from this parent manifest and must carry its own evidence and integrity check. Author project files were not read or changed by packet assembly.
