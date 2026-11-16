// The content security policy of the packaged app. `src-tauri/tauri.conf.json`
// carries the same string (a test keeps the two identical), and `vite preview`
// serves the production build under it so the browser suites exercise the app
// exactly as the policy constrains it.
//
// Scripts load only from the app itself and are never inline, so markup that
// reaches the page (a manuscript, a model reply) cannot bring code with it.
// `'unsafe-eval'` is allowed for one reason: the shared contracts package
// compiles its JSON-schema validators at startup with `new Function`. Shipping
// those validators precompiled would let this be removed.
// Styles may be inline because React and the editor set them at runtime.
// Connections are limited to the native bridge and encrypted endpoints, which
// the optional sync and voice features choose at run time.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ipc: http://ipc.localhost https: wss:",
  "media-src 'self' blob: mediastream:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");
