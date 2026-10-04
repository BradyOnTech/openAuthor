import { describe, expect, it } from "vitest";

import { loadMobileConfig } from "../src/config";

describe("loadMobileConfig", () => {
  it("accepts only public client configuration over secure origins", () => {
    expect(loadMobileConfig({
      EXPO_PUBLIC_SUPABASE_URL: "https://project.supabase.co/",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      EXPO_PUBLIC_GATEWAY_URL: "https://voice.example.com/",
    })).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_example",
      gatewayUrl: "https://voice.example.com",
    });
  });

  it("fails closed for missing configuration, insecure remote URLs, or secret keys", () => {
    expect(() => loadMobileConfig({})).toThrow("EXPO_PUBLIC_SUPABASE_URL");
    expect(() => loadMobileConfig({
      EXPO_PUBLIC_SUPABASE_URL: "http://project.example.com",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      EXPO_PUBLIC_GATEWAY_URL: "https://voice.example.com",
    })).toThrow("HTTPS");
    expect(() => loadMobileConfig({
      EXPO_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do-not-ship",
      EXPO_PUBLIC_GATEWAY_URL: "https://voice.example.com",
    })).toThrow("secret");
    const serviceRole = [
      btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
      btoa(JSON.stringify({ role: "service_role" })),
      "signature",
    ].map((part) => part.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")).join(".");
    expect(() => loadMobileConfig({
      EXPO_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRole,
      EXPO_PUBLIC_GATEWAY_URL: "https://voice.example.com",
    })).toThrow("secret");
  });
});
