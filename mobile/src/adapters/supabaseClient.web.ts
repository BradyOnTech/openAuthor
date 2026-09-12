import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MobileConfig } from "../config";
import type { MobileSupabaseClient } from "./supabaseAdapters";
import { browserStorage } from "./browserStorage";
import { isMobileAuthStorageKey, mobileAuthStorageKey } from "../core/authStorageKey";

export function createMobileSupabaseClient(config: MobileConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storageKey: mobileAuthStorageKey(config),
      storage: {
        getItem: (key) => browserStorage.get(`auth:${key}`),
        setItem: (key, value) => browserStorage.set(`auth:${key}`, value),
        removeItem: (key) => browserStorage.delete(`auth:${key}`),
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export async function clearMobileAuthSession(config: MobileConfig): Promise<void> {
  const base = `auth:${mobileAuthStorageKey(config)}`;
  for (const key of (await browserStorage.keys(base)).filter((key) => isMobileAuthStorageKey(key, base))) await browserStorage.delete(key);
}

export function asMobileSupabaseClient(client: SupabaseClient): MobileSupabaseClient {
  return client as unknown as MobileSupabaseClient;
}
