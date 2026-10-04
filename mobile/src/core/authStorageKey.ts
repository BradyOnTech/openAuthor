import type { MobileConfig } from "../config";

/** Explicitly retain the existing Supabase storage namespace for safe upgrades. */
export function mobileAuthStorageKey(config: Pick<MobileConfig, "supabaseUrl">): string {
  return `sb-${new URL(config.supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

export function isMobileAuthStorageKey(key: string, base: string): boolean {
  return key === base || key.startsWith(`${base}-`);
}
