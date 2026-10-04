import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MobileConfig } from "../config";
import type { MobileSupabaseClient } from "./supabaseAdapters";
import { browserStorage } from "./browserStorage";
import { mobileAuthStorageKey } from "../core/authStorageKey";

export function createMobileSupabaseClient(config: MobileConfig): SupabaseClient {
  const lease = browserStorage.authLease(`auth:${mobileAuthStorageKey(config)}`);
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storageKey: mobileAuthStorageKey(config),
      storage: {
        getItem: (key) => lease.get(`auth:${key}`),
        setItem: (key, value) => lease.set(`auth:${key}`, value),
        removeItem: (key) => lease.delete(`auth:${key}`),
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export async function clearMobileAuthSession(config: MobileConfig): Promise<void> {
  await browserStorage.clearAuth(`auth:${mobileAuthStorageKey(config)}`);
}

export function asMobileSupabaseClient(client: SupabaseClient): MobileSupabaseClient {
  return client as unknown as MobileSupabaseClient;
}
