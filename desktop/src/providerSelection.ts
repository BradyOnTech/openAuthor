import type { GenerationRuntimeConfig, ProposalProvider } from "./types";

export type AvailableProvider = {
  id: ProposalProvider;
  model: string;
};

// A signed-in ChatGPT plan is the product default. API-backed providers remain
// available as fallbacks and explicit choices.
const PROVIDER_PRIORITY: ProposalProvider[] = [
  "openai-codex",
  "openai",
  "anthropic",
  "openrouter",
  "local",
];

export function availableProviders(
  runtimeConfig: GenerationRuntimeConfig | null | undefined
): AvailableProvider[] {
  if (!runtimeConfig) return [];

  return PROVIDER_PRIORITY.flatMap((id) => {
    const config = runtimeConfig.providers[id];
    return config.credential_present
      ? [{ id, model: config.default_model }]
      : [];
  });
}

export function defaultProvider(
  runtimeConfig: GenerationRuntimeConfig | null | undefined
): AvailableProvider {
  return availableProviders(runtimeConfig)[0] ?? {
    id: "local",
    model: runtimeConfig?.providers.local.default_model ?? "local-deterministic",
  };
}
