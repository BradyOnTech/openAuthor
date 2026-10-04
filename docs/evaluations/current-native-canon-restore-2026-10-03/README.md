# Current native Canon and interrupted restore — 2026-10-03

The unsigned local arm64 QA application passed three native Canon checks and an interrupted portable restore/relaunch/retry drill using exact core/Desktop source `36a40582bd4667440f5614c4f73141ea1bdaf51b`. All six priorities remain **in progress**. This packet records local acceptance evidence; it does not certify release or author quality.

The QA executable SHA-256 is `195c81233806fda9fc3f68d6d162af3f7c294357e88f352200ef218ccf31946f`. The 64 installed core files match aggregate `fa60a9dc36ab214668688177b3a93283008701ce38c9b7f6ae9a0146868a5f46`. The isolated acceptance launcher, launch handoff and normal/QA bundle manifests are retained. The independent [current packaged-runtime packet](../current-packaged-runtime-2026-10-03/README.md) already records 583 passing core tests with no failures, errors or skips; that suite was not repeated here.

## Observed behavior

- A genuine packaged Storyline switch invalidated an already-open accepted Fact review while leaving its timestamp unchanged. The native save was refused, the dirty passage remained visible, and all five captured book files matched the fresh post-open baseline.
- On the original Storyline, the retained passage was saved as evidence at offsets **19–63, end exclusive**. Only the accepted Fact's evidence and `updated_at` changed in raw Memory; the suggested Fact and the other four captured files stayed exact.
- An inverted validity interval on a suggested Fact remained labeled for author review and excluded from accepted Canon checks. Native acceptance was refused; both Facts and all five captured files stayed exact.
- A real GUI-spawned packaged restore was paused during extraction: **375 complete, 1 incomplete and 26 missing** of 402 archived files. The destination did not exist. The QA parent was killed; the stopped worker disappeared before the final worker signal lookup. The crash helper raised `ProcessLookupError`, and the subsequent terminal/file readback confirmed both processes gone, destination absent, and original source/ZIP/partial stage unchanged. No final worker kill or successful uninterrupted helper completion is claimed.
- Relaunch manually showed only the Canon fixture in Projects, with no partial restored book. The actual native retry, without the observer, opened the restored 64-scene book. A separate normal packaged Python verification confirmed **401 exact project files, 129 healthy Revisions and two Git branch refs**, with the original 490 source files and ZIP unchanged. Post-cleanup raw captures retain those 401 project files plus three exact Git ref files.

An earlier normal packaged CLI mechanics trial independently captured 44 complete/1 incomplete/357 missing files, killed its exact owned worker, observed an absent destination, and retried the untouched ZIP successfully. Its original 75-file seal is retained unchanged.

## Evidence and boundaries

Native UI observations are root manual CUA accessibility/inline screenshot transcriptions. There is **no archived native screenshot set or automated GUI replay**. Dirty-draft retention is a visible manual observation, not a retained recovery-journal payload. The external Storyline change used packaged APIs; this was not a GUI-only Storyline-switch drill. Returning to `master` is supported by the packaged readbacks; the exact GUI return action was not separately archived.

Initial project opening normalized only `manuscript/structure.json`'s `unassigned_scene_ids` from `[]` to the two scene IDs. Refusal comparisons use the fresh normalized baseline. Canon byte-preservation claims cover the five captured files, not the whole workspace or history.

Canon readback JSON retains the exact installed package path/core hashes but omits the historical interpreter executable/version and command exit receipt. This provenance gap is disclosed rather than reconstructed. The first Storyline helper had an import-name setup error before mutation; its original script and failure record remain included as a harness failure, not a product defect.

The actual native restore worker argv did not include `-I -B`; its observed bundled path/parent/argv and isolation launcher are retained. The recorded independent restore verification helper used bundled Python with `-I -B`. The GUI-restored readback inherits a generic CLI-verifier scope label: the GUI retry/attachment is supported separately by the manual native transcript; the normal packaged helper verified the GUI's resulting files and history. The failed crash helper has no retained stdout file; `gui-crash.json` accurately records the outcome and later verification, without inventing a full historical trace.

Unpublished private staging siblings remain retained. This proves bounded destination publication and the observed recent-book registry behavior, not automatic staging cleanup or exclusion of manually chosen staging paths. All owned native/readback processes are terminal. The owned Finder window was closed and the original Developer window restored, according to the root manual observation. Four existing author artifacts and each bundle's 2,205 immutable files stayed exact; the original bundle manifests exclude volatile `__pycache__` files only.

No writing-provider calls, deployed mutations, or system/account changes occurred. Signed/notarized clean-machine and Intel install/upgrade acceptance, physical power loss/storage failures, VoiceOver, real mobile/deployed lifecycle drills, fresh author prose quality/review-time evidence and remaining dependency gates remain outside this packet.

## Retained files

| File | Contents |
| --- | --- |
| `canon-originals.tar.gz` | 59 unchanged Canon originals and independent audit files |
| `cli-originals.tar.gz` | 76 originals: 75 sealed CLI files plus their original seal; genuine ZIP and source snapshot included |
| `gui-originals.tar.gz` | 396 originals: GUI partial observation, root crash/retry/cleanup/preservation receipts, helpers and bundle provenance |
| `gui-restored-files.tar.gz` | 404 raw files copied after native retry/quit: 401 project files and three Git ref files |
| `receipts.json` | Archive/member hashes, sizes, original private paths and capture limits |
| `results.json` | Bounded outcomes and remaining scope |
| `verify.py` | Read-only archive integrity and receipt correlations |
| `evidence-sha256.json` | Final packet file seal |

The four archives total 2,627,282 bytes. Original bytes and preexisting seals are preserved. Archived scripts are evidence, not commands to replay against sealed private roots.

Run from the repository root:

```sh
python3 -B docs/evaluations/current-native-canon-restore-2026-10-03/verify.py
```

The verifier does not extract archives, execute helpers, invoke the core, inspect/control processes, open apps, take locks or access the network. It checks seals, original backup and raw published files/refs, partial extraction counts, Canon deltas and retained receipt correlations. It is not a replay of the native acceptance. Optional `--current` also reads the current 64 source modules, four author artifact hashes and private normal/QA immutable bundle files; those temporary bundle paths must still exist.
