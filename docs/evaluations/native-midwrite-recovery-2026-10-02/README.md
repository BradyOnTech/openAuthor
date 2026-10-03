# Native interruption recovery checkpoint

The unsigned isolated QA app built from `a5230979315e3e0dd665c5cae5b9af44fa399f93` recovered two actual native GUI transactions interrupted after the first scene replacement. A synthetic book held three coordinated, one-hunk Change Sets; each scene retained about 256 KiB of unchanged prose. No provider call or production manuscript was used.

| Native GUI operation | State captured before termination | State after native startup |
| --- | --- | --- |
| Apply three Change Sets together | Active journal with three participating files; scene 1 changed, scenes 2 and 3 original | All eight original baseline files matched, three proposals remained pending, original HEAD returned, journal retired |
| Undo those three scenes together | Active journal with one participating file; scene 1 original, scenes 2 and 3 still applied | All eight applied baseline files matched, shared apply HEAD returned, journal retired |

The first apply was retried successfully before the undo drill. After undo recovery, the native GUI retried undo successfully: all three whole scene files matched the originals byte for byte, every proposal referenced one shared undo Revision, and the reachable history contained seven Revisions. The original and applied baselines, stopped-worker raw files, journals, packaged readbacks, final eight-file freeze and Revision records are retained losslessly in `inputs.tar.gz`.

An external observer identified the exact QA child by parent PID, packaged executable, command arguments, start time and fixture working directory. It sent SIGSTOP only after observing an active journal and changed scene bytes. Root stopped the owned app and readers while the mutation worker remained paused, then killed that worker last. Native startup performed recovery before root's normal core readbacks; raw file comparisons and journal absence were checked first. No production hook or modified transaction engine was used.

The GUI observations in `receipts/root/observations.json` are **root's manual transcription of live CUA accessibility text and inline screenshots**. Native screenshot and AX byte files are not archived. Process, journal, file and source correlations have separate retained receipts. Two disposable CLI trials establish observer mechanics only. The native executable path-normalization check, incomplete initial applied-baseline copy and missing `--id` readback attempt are preserved as preparation evidence; they did not mutate the product. Trial manifests intentionally rebase the private copied-book paths, so their inherited preparation seals are checked with that documented manifest exception.

The app and its owned sidecar exited, the original Finder window was restored, no system setting changed, and all four production author-artifact hashes matched before and after. Build metadata identifies the alternate local QA bundle and exact packaged core. The source archive matches all 64 packaged Python modules from the older a523 commit; it does not certify the newer Canon-source native build.

From the repository root, run `python3 docs/evaluations/native-midwrite-recovery-2026-10-02/verify.py`. The verifier resolves files beside its own source, so an absolute script path also works from another directory. It reads only this packet and checks lossless archive hashes, source fingerprints, raw journal/file membership, process guards, original/applied/final baselines, readback bodies and shared Revision history. It **does not replay the GUI or repeat the recovery experiment**. `--seal` refreshes the integrity manifest only after correlation checks pass.

This checkpoint does not establish Developer ID signing, notarization, clean-machine installation or upgrade, physical power loss, interruption during backup restore, VoiceOver, display scaling, long-session use, physical mobile/deployment acceptance, or fresh author editorial/Memory acceptance. All six priorities remain in progress.
