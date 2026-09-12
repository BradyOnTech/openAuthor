import type { SupabaseClient } from "@supabase/supabase-js";
import { deploymentScope, nativeSecrets, type DesktopSecretStore } from "./secretStore";

export type CloudSession = { userId: string; email: string; accessToken: string };
export interface CompanionAccount {
  session(expected?: { userId: string; deviceId?: string }): Promise<CloudSession | null>;
  signIn(email: string, password: string): Promise<CloudSession>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  rpc(name: string, params: Record<string, unknown>): Promise<unknown>;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCompanionAccount(client: SupabaseClient): CompanionAccount {
  const account: CompanionAccount = {
    async session(expected) {
      const result = await client.auth.getSession();
      if (result.error) throw new Error("Your companion session could not be restored. Please sign in again.");
      const session = result.data.session;
      if (!session) return null;
      const verified = await client.auth.getClaims(session.access_token);
      const claims = verified.data?.claims;
      if (verified.error || !claims || typeof claims.sub !== "string" || !UUID.test(claims.sub)
        || claims.sub !== session.user.id || claims.role !== "authenticated"
        || typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000
        || expected && (claims.sub !== expected.userId
          || expected.deviceId !== undefined && claims.device_id !== expected.deviceId)) {
        throw new Error("The companion session identity could not be verified. Please reconnect.");
      }
      return { userId: claims.sub, email: session.user.email ?? "", accessToken: session.access_token };
    },
    async signIn(email, password) {
      if (!email.trim() || !password) throw new Error("Enter your email and password.");
      const result = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error || !result.data.session) {
        throw new Error("Sign-in failed. Check your credentials and connection, then try again.");
      }
      try {
        const session = await account.session();
        if (!session) throw new Error("Sign-in did not establish a session.");
        return session;
      } catch {
        await client.auth.signOut({ scope: "local" });
        throw new Error("Sign-in could not be verified. Please try again.");
      }
    },
    async signOut() {
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw new Error("Sign-out could not be completed. Please retry.");
    },
    async refresh() {
      const result = await client.auth.refreshSession();
      if (result.error || !result.data.session) {
        throw new Error("The device session could not be refreshed. Please sign in again.");
      }
    },
    async rpc(name, params) {
      const result = await client.rpc(name, params);
      if (result.error) throw new Error("Companion setup was refused by the backend. Check project access and device enrollment.");
      return result.data;
    },
  };
  return account;
}

export function cloudConfiguration(): { url: string; publishableKey: string } | null {
  const env = import.meta.env;
  const url = env?.VITE_SUPABASE_URL?.trim();
  const publishableKey = env?.VITE_SUPABASE_ANON_KEY?.trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

export function createAuthStorage(scope: string, secrets: DesktopSecretStore) {
  async function slot(key: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    return `auth-${scope}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return {
    getItem: async (key: string) => secrets.get(await slot(key)),
    setItem: async (key: string, value: string) => secrets.set(await slot(key), value),
    removeItem: async (key: string) => secrets.remove(await slot(key)),
  };
}

let accountPromise: Promise<CompanionAccount> | null = null;
export function desktopAccount(): Promise<CompanionAccount> {
  if (!accountPromise) {
    accountPromise = (async () => {
      const config = cloudConfiguration();
      if (!config) throw new Error("Companion hosting has not been configured for this build.");
      const scope = await deploymentScope(config.url);
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(config.url, config.publishableKey, {
        auth: {
          storage: createAuthStorage(scope, nativeSecrets),
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
      return createCompanionAccount(client);
    })().catch((error) => { accountPromise = null; throw error; });
  }
  return accountPromise;
}

export async function desktopAccessToken(): Promise<string | null> {
  return (await (await desktopAccount()).session())?.accessToken ?? null;
}
