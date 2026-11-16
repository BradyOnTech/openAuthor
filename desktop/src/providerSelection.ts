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

const PROVIDER_LABELS: Record<ProposalProvider, string> = {
  "openai-codex": "ChatGPT (your subscription)",
  openai: "OpenAI API",
  anthropic: "Anthropic API",
  openrouter: "OpenRouter",
  local: "Offline demo (mechanical edits only)",
};

/** The name an author sees for a provider id. */
export function providerLabel(id: ProposalProvider): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * True when only the built-in offline engine is available. It makes small
 * rule-based edits and cannot follow creative direction, so surfaces that
 * generate prose say so before the author judges the result.
 */
export function onlyOfflineDemo(runtimeConfig: GenerationRuntimeConfig | null | undefined): boolean {
  if (!runtimeConfig) return false;
  return availableProviders(runtimeConfig).every(provider => provider.id === "local");
}
