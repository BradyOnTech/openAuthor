import { describe, expect, it } from "vitest";
import type { GenerationRuntimeConfig } from "./types";
import { availableProviders, defaultProvider } from "./providerSelection";

function config(credentials: Partial<Record<keyof GenerationRuntimeConfig["providers"], boolean>> = {}): GenerationRuntimeConfig {
  return {
    retry: { max_retries: 2, base_delay_ms: 350 },
    providers: {
      local: { default_model: "local-deterministic", credential_present: true },
      openai: { default_model: "openai-model", credential_present: credentials.openai ?? false, base_url: "" },
      anthropic: { default_model: "anthropic-model", credential_present: credentials.anthropic ?? false, base_url: "" },
      openrouter: { default_model: "router-model", credential_present: credentials.openrouter ?? false, base_url: "" },
      "openai-codex": {
        default_model: "codex-recommended",
        credential_present: credentials["openai-codex"] ?? false,
        runtime_available: true,
        auth_type: "codex_app_server",
        email: "",
        plan_type: "",
        error: "",
      },
    },
  };
}

describe("provider selection", () => {
  it("defaults to the ChatGPT subscription when it is authenticated", () => {
    const runtime = config({
      "openai-codex": true,
      openai: true,
      anthropic: true,
      openrouter: true,
    });

    expect(defaultProvider(runtime)).toEqual({
      id: "openai-codex",
      model: "codex-recommended",
    });
    expect(availableProviders(runtime).map(({ id }) => id)).toEqual([
      "openai-codex",
      "openai",
      "anthropic",
      "openrouter",
      "local",
    ]);
  });

  it("falls back to an authenticated API provider, then local", () => {
    expect(defaultProvider(config({ anthropic: true })).id).toBe("anthropic");
    expect(defaultProvider(config()).id).toBe("local");
    expect(defaultProvider(null).id).toBe("local");
  });
});
