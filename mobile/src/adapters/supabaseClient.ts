import "react-native-url-polyfill/auto";

import { createClient, processLock, type SupabaseClient } from "@supabase/supabase-js";
import Storage from "expo-sqlite/kv-store";

import type { MobileConfig } from "../config";
import type { MobileSupabaseClient } from "./supabaseAdapters";
import { isMobileAuthStorageKey, mobileAuthStorageKey } from "../core/authStorageKey";

export function createMobileSupabaseClient(config: MobileConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storageKey: mobileAuthStorageKey(config),
      storage: Storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
}

export async function clearMobileAuthSession(config: MobileConfig): Promise<void> {
  const base = mobileAuthStorageKey(config);
  for (const key of (await Storage.getAllKeys()).filter((key) => isMobileAuthStorageKey(key, base))) await Storage.removeItem(key);
}

export function asMobileSupabaseClient(client: SupabaseClient): MobileSupabaseClient {
  return client as unknown as MobileSupabaseClient;
}
