# Desktop dependency PR integration — 2026-10-04

PRs #11–#20 were integrated with merge commits. Each original PR head is an ancestor of the verified source commit `8d737748463c215f347a7af94f28e92d98e6fd7b`; `verification.json` records the exact heads and ancestry checks. No dependency PR was merely discarded or replaced by a cherry-pick.

| PR | Final integrated dependency |
| --- | --- |
| #11 | Tauri 2.12.1, runtime 2.12.1, runtime-wry 2.12.1 |
| #12 | rfd 0.17.2 |
| #13 | serde_json 1.0.151 |
| #14 | tauri-build 2.7.1 |
| #15 | serde, serde_core and serde_derive 1.0.229 |
| #16 | Tauri API/CLI 2.12.1; Testing Library React 16.3.3 and user-event 14.6.7 |
| #17 | Vitest 5.0.3, satisfying the PR's `^5.0.2` range |
| #18 | React and its types 19.3.0 |
| #19 | ReactDOM and its types 19.3.0 |
| #20 | TypeScript 7.0.2 |

The npm and Cargo lockfiles were regenerated against the current feature branch. They retain its contracts, Supabase, cryptography, filesystem locking and Keychain dependencies. The old partial Tauri update allowed runtime-wry 2.10.1 to compile against newer runtime traits. The stable Tauri 2.12.1 family requires its matching runtime and runtime-wry versions, avoiding that broken graph. Versions were checked against primary npm and crates.io metadata; no Tauri 3 prerelease was introduced.

React and ReactDOM were migrated together. The first TypeScript build exposed the React 19 type changes: an explicit `useRef` initializer and an imported React `JSX` type are now supplied. Full-suite runs also exposed tests clicking Refresh/Compare before their permission or preservation controls became enabled. The tests now wait for the real enabled controls. Their assertions and the production permission/preservation guards are retained.

The embedded Git builder now sources the repository's existing Rust environment. Fresh preparation previously failed with `cargo: command not found` even though the Rust toolchain was installed. After the fix, a fresh checksum-pinned Git 2.55 build passed with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, using the normal builder invocation.

Scheduled npm and Cargo desktop updates now share one weekly Dependabot multi-ecosystem group, keeping the React packages and Tauri frontend/backend updates in one reviewable PR. The YAML parses successfully and follows [GitHub's documented multi-ecosystem configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-multi-ecosystem-updates). GitHub will exercise its scheduled updater after this configuration reaches the default branch. Workflow changes are owned by the separate CI integration.

## Verification

- Fresh locked contracts and desktop npm installs passed; `npm ls` has no peer dependency errors.
- All **710 desktop unit tests in 92 files** passed, with no skips.
- TypeScript 7 and the production Vite build passed.
- The desktop npm audit reports **0 vulnerabilities**.
- Locked Cargo check passed. Cargo tests passed **10 tests**; the existing real-Keychain opt-in test was ignored.
- Repository integrity, capability and placeholder checks passed.
- Python 3.11.15, Codex 0.144.6 and Git 2.55 runtimes were freshly prepared from pinned archives/source with verified checksums. Existing parent-worktree runtime files were not copied.
- The real ARM64 release build produced `openAuthor.app` and `openAuthor_0.1.0_aarch64.dmg`.
- The package checker passed with a clean source checkout at `8d73774`: the bundled core matches the reviewed source exactly; application, Python, Codex and Git contain ARM64; the packaged engine recovered at all five forced-termination stages without system tools on PATH; the bundled Codex contract test passed against a local Responses endpoint.

`bundle-receipt.json` records executable hashes, runtime provenance and source freshness. `verification.json` records the DMG hash. `source-sha256.json` seals changed source files. `artifact-sha256.json` seals this packet. Compressed raw logs include the initial permission-test failure, final successful checks and package/runtime results. The earlier runtime-check and package-build logs precede the final source commits; the final package receipt is the checked-source record.

## Limits

This verifies the integrated desktop dependencies and an ARM64 package on this machine. It is not a release certificate. The real-Keychain opt-in test, a native Intel package, Developer ID signing/notarization, clean-machine GUI acceptance, accessibility acceptance, physical voice devices, live providers and deployed cloud acceptance were not performed by this desktop dependency task. The receipt retains those distinctions explicitly. The parent integration task must validate the final combined branch and merge it into remote `main`.
