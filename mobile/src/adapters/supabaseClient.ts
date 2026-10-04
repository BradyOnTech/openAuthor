import "react-native-url-polyfill/auto";

import { createClient, processLock, type SupabaseClient } from "@supabase/supabase-js";
import Storage from "expo-sqlite/kv-store";

import type { MobileConfig } from "../config";
import type { MobileSupabaseClient } from "./supabaseAdapters";
import { EncryptedFileSnapshotCache } from "./encryptedSnapshotCache";
import { EncryptedAuthStorage } from "../core/encryptedAuthStorage";
import { mobileAuthStorageKey } from "../core/authStorageKey";

function authStorage(config: MobileConfig): EncryptedAuthStorage {
  return new EncryptedAuthStorage({ deployment: config.supabaseUrl, base: mobileAuthStorageKey(config),
    encrypted: new EncryptedFileSnapshotCache(), legacy: Storage });
}

export function createMobileSupabaseClient(config: MobileConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storageKey: mobileAuthStorageKey(config),
      storage: authStorage(config),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  });
}

export async function clearMobileAuthSession(config: MobileConfig): Promise<void> {
  await authStorage(config).clear();
}

export function asMobileSupabaseClient(client: SupabaseClient): MobileSupabaseClient {
  return client as unknown as MobileSupabaseClient;
}
