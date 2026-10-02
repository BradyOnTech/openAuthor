import { spawnSync } from "node:child_process";

// Test-only build: no production entrypoint or runtime test bypass is added.
const env = {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: "https://companion-backend.test",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_e2e_fixture",
  EXPO_PUBLIC_GATEWAY_URL: "https://companion-gateway.test",
};
for (const args of [
  ["scripts/build-security.mjs", "export", "--platform", "web", "--output-dir", ".expo/hosted-e2e"],
  ["scripts/build-pwa.mjs", ".expo/hosted-e2e"],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
