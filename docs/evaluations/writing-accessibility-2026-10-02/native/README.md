# Native writing acceptance at `96bd04d`

The normal unsigned arm64 app builds from clean tracked source and passes the
canonical copied-bundle verifier: exact core, pinned runtime identities, Codex
wire contract and five packaged-engine SIGKILL stages. Its application SHA-256
is `ad1d3de50ee15b9527ce439f1a68e681cb4b5852efe18f6ff9bfcc65a999e189`.
`default-bundle-report-96bd04d.json` retains the independent manual gates as
unobserved. Final native builds include the final frontend typecheck/build.

An identity-only local acceptance flavor uses the retained fresh application
identifier and empty Supabase configuration. Its declared identifier/version
were explicitly checked against the retained overlay/base configuration. Its
core matches source exactly and its Python/Codex/Git binary hashes match the
verified canonical bundle. The canonical verifier was not changed or represented
as accepting this alternate identity. The normal bundle was restored to the
usual build output before GUI work; the GUI used the separate temporary copy.

The launcher scopes fallback working directories and Codex home to the disposable
folder, disables external provider keys, and selects `/usr/bin/false` for Codex.
This stops startup authentication before the app-server launch. Local/empty cloud
configuration prevents registry account/Keychain restoration; a different bundle
identifier alone does not change the fixed native Keychain service.

WebKit's upstream implementation scopes default persistent website storage to
the nonnil main bundle identifier. This is a source-backed inference for the
installed framework, whose matching public source tag was unavailable. Actual
fresh Welcome and same-identifier restart persistence were observed.
[WebKit implementation](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/WebsiteData/Cocoa/WebsiteDataStoreCocoa.mm)

`observations.json` records root's limited computer-use observations: fresh
Welcome; visible light-theme title/prose keyboard rings; Escape from the focused
Exit button followed by insertion at caret 5; recovered scene/Plan tabs with
Plan selected after the exact native process was killed; retained Synopsis and
new-act drafts; and resumed keyboard insertion at caret 11. Bundled-core JSON
reads confirm exact saved scene bytes and that unfinished Plan text was not
automatically written to the book. After restart the activity rail showed
Manuscript while the Plan document remained selected; this is not a claim that
all UI preferences were restored. Four existing author artifact hashes match
before/after. The test app was normally closed and the temporary Finder window
was closed, restoring the original Developer window.

These are transcribed native observations; screenshots and full AX trees remain
in the chat's tool transcript, not in this packet. The archived browser images
in the parent packet are not native screenshots. The initial explicit WebKit
store config failed in Tauri code generation (`Vec<u8>` versus `[u8; 16]`);
the failed overlay and raw build log remain separate. No installed dependency
or production Rust/configuration was patched. App-selection tool calls stalled
despite requested timeouts and one clipboard action failed; their outcomes and
corrections are retained. These do not measure application startup or prove
active author sessions of that duration.

This does not establish dark-theme or conflict-visible native behavior, full
contrast/VoiceOver/text-scaling review, signed multi-scene GUI crash/backup,
clean-machine installation/upgrade, Intel, physical power loss, native account
or Keychain handling, phones, deployed services or provider quality. Broad
placeholder/ghost-text contrast remains outside these sampled repairs. All six
acceptance priorities remain open; `release_certified` is false.

Run `python3 docs/evaluations/writing-accessibility-2026-10-02/native/verify.py`
to verify the retained artifact hashes and internal scope/identity associations.
Pass `--app` with the retained temporary acceptance app to additionally compare
its actual identity, binaries and installed core. This does not rerun GUI tests.
