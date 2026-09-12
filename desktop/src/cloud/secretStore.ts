export interface DesktopSecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  // Atomically persist or return the existing identity, even across app processes.
  create(key: string, value: string): Promise<string>;
}

export function hasNativeCredentialStore(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function access(operation: string, key: string, value?: string): Promise<string | null> {
  if (!hasNativeCredentialStore()) {
    throw new Error("Secure sign-in requires the macOS desktop app. Local writing is still available.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<string | null>("desktop_secret", { operation, key, value: value ?? null });
  } catch {
    throw new Error("The secure credential store is unavailable. Unlock the macOS Keychain and retry.");
  }
}

export const nativeSecrets: DesktopSecretStore = {
  get: (key) => access("read", key),
  set: async (key, value) => { await access("write", key, value); },
  remove: async (key) => { await access("remove", key); },
  create: async (key, value) => {
    const stored = await access("create", key, value);
    if (!stored) throw new Error("Device identity could not be persisted securely.");
    return stored;
  },
};

export async function deploymentScope(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Companion sync requires an HTTPS backend origin.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed.origin));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
