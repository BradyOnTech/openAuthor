import { useEffect, useState, type ReactNode } from "react";
import { cloudConfiguration, desktopAccount } from "./account";
import { CloudSignIn } from "./CloudSignIn";
import { hasNativeCredentialStore } from "./secretStore";

export function RegistryAuthGate({ children }: {
  children(mode: "auto" | "local"): ReactNode;
}) {
  const env = import.meta.env;
  const needsAccount = env?.VITE_PROJECT_REGISTRY !== "local" && !!cloudConfiguration()
    && (!env?.VITEST || env.VITE_PROJECT_REGISTRY === "supabase");
  const [mode, setMode] = useState<"checking" | "signin" | "hosted" | "local">(needsAccount ? "checking" : "local");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!needsAccount) return;
    let active = true;
    if (!hasNativeCredentialStore()) { setMode("signin"); return; }
    void desktopAccount().then((account) => account.session()).then((session) => {
      if (active) setMode((current) => current === "checking" ? session ? "hosted" : "signin" : current);
    }).catch(() => {
      if (active) {
        setError("Your cloud session could not be restored. Sign in again or continue locally.");
        setMode((current) => current === "checking" ? "signin" : current);
      }
    });
    return () => { active = false; };
  }, [needsAccount]);
  if (mode === "local" || mode === "hosted") return <>{children(mode === "local" ? "local" : "auto")}</>;
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
    <section style={{ width: "100%", maxWidth: 440, display: "grid", gap: 16 }}>
      <h1>Welcome to openAuthor</h1>
      <p>Connect to your shared project library, or continue with books on this computer.</p>
      {error && <p role="alert">{error}</p>}
      {mode === "checking" ? <p role="status">Restoring your secure session…</p>
        : <CloudSignIn onSignedIn={() => setMode("hosted")} />}
      <button className="btn" onClick={() => setMode("local")}>Continue with local books</button>
    </section>
  </main>;
}
