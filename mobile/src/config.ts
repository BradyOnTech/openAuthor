export type MobileConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  gatewayUrl: string;
};

export type MobilePublicEnvironment = Partial<Record<
  | "EXPO_PUBLIC_SUPABASE_URL"
  | "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "EXPO_PUBLIC_SUPABASE_ANON_KEY"
  | "EXPO_PUBLIC_GATEWAY_URL",
  string
>>;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function required(env: MobilePublicEnvironment, name: keyof MobilePublicEnvironment): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function secureUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error(`${name} must use HTTPS outside localhost.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, query parameters, or fragments.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function publicKey(env: MobilePublicEnvironment): string {
  const value = (
    env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? ""
  ).trim();
  if (!value) {
    throw new Error("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required.");
  }
  if (/^sb_secret_/i.test(value) || /service[_-]?role/i.test(value)) {
    throw new Error("A Supabase secret/service-role key must never be bundled in mobile.");
  }
  const parts = value.split(".");
  if (parts.length === 3) {
    try {
      const encoded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
      let accumulator = 0;
      let bitCount = 0;
      const bytes: number[] = [];
      for (const character of encoded) {
        const index = BASE64URL_ALPHABET.indexOf(character);
        if (index < 0) throw new Error("invalid base64url");
        accumulator = (accumulator << 6) | index;
        bitCount += 6;
        if (bitCount >= 8) {
          bitCount -= 8;
          bytes.push((accumulator >> bitCount) & 0xff);
        }
      }
      const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as {
        role?: unknown;
      };
      if (payload.role !== "anon") {
        throw new Error("A Supabase secret/service-role key must never be bundled in mobile.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("secret/service-role")) throw error;
      throw new Error("The legacy Supabase public JWT is invalid.");
    }
  }
  return value;
}

// Expo only inlines EXPO_PUBLIC_* variables when each property is referenced
// statically. Keep this object literal explicit; dynamic env enumeration leaves
// undefined values in production bundles.
const runtimeEnvironment: MobilePublicEnvironment = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_GATEWAY_URL: process.env.EXPO_PUBLIC_GATEWAY_URL,
};

export function loadMobileConfig(
  env: MobilePublicEnvironment = runtimeEnvironment,
): MobileConfig {
  return {
    supabaseUrl: secureUrl(required(env, "EXPO_PUBLIC_SUPABASE_URL"), "Supabase URL"),
    supabasePublishableKey: publicKey(env),
    gatewayUrl: secureUrl(required(env, "EXPO_PUBLIC_GATEWAY_URL"), "Session Gateway URL"),
  };
}
