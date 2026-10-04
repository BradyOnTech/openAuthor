import { useEffect, useRef, useState } from "react";
import { desktopAccount, type CloudSession } from "./account";
import { hasNativeCredentialStore } from "./secretStore";

export function CloudSignIn({ onSignedIn }: { onSignedIn(session: CloudSession): void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!hasNativeCredentialStore()) {
    return <p>Secure companion sign-in requires the macOS desktop app. You can still write locally in this preview.</p>;
  }
  return <form aria-label="Companion sign-in" style={{ display: "grid", gap: 12 }} onSubmit={(event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const account = await desktopAccount();
        const session = await account.signIn(email, password);
        // Legacy pasted access tokens are deliberately not reused or migrated.
        try { window.localStorage.removeItem("openauthor.supabaseAccessToken"); } catch { /* Optional legacy cleanup. */ }
        if (active.current) onSignedIn(session);
      } catch (reason) {
        if (active.current) setError(reason instanceof Error ? reason.message : "Sign-in failed. Please retry.");
      } finally {
        if (active.current) { setPassword(""); setBusy(false); }
      }
    })();
  }}>
    <p style={{ margin: 0 }}>Sign in with your companion account. Your session is stored in the macOS Keychain.</p>
    <label>Email<input className="input" type="email" autoComplete="username" required value={email}
      onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
    <label>Password<input className="input" type="password" autoComplete="current-password" required value={password}
      onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
    {error && <p role="alert">{error}</p>}
    <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form>;
}
