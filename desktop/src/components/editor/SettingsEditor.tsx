import { useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { authLogin, authLogout } from "../../api";
import type { GenerationRuntimeConfig, ProposalProvider } from "../../types";

const PROVIDER_INFO: {
  id: ProposalProvider;
  label: string;
  envVar: string;
  envUrl?: string;
}[] = [
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", envUrl: "OPENAUTHOR_OPENAI_BASE_URL" },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", envUrl: "OPENAUTHOR_ANTHROPIC_BASE_URL" },
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", envUrl: "OPENAUTHOR_OPENROUTER_BASE_URL" },
  { id: "local", label: "Local (testing)", envVar: "" },
];

export function SettingsEditor() {
  const { runtimeConfig, refreshRuntimeConfig, budget, projectRoot, setError, setMessage } = useWorkspace();

  if (!runtimeConfig) {
    return (
      <div className="settings-editor">
        <div className="settings-editor__loading">Loading configuration...</div>
      </div>
    );
  }

  return (
    <div className="settings-editor">
      <div className="settings-editor__inner">
        <h2 className="settings-editor__title">Provider Settings</h2>
        <p className="settings-editor__subtitle">
          Configure AI providers for chat and proposal generation.
        </p>

        <div className="settings-editor__section">
          <h3 className="settings-editor__section-title">Subscription</h3>
          <CodexAuthCard
            config={runtimeConfig}
            projectRoot={projectRoot}
            onAuthChanged={refreshRuntimeConfig}
            setError={setError}
            setMessage={setMessage}
          />
        </div>

        <div className="settings-editor__section">
          <h3 className="settings-editor__section-title">API Key Providers</h3>
          {PROVIDER_INFO.map((p) => (
            <ProviderCard
              key={p.id}
              info={p}
              config={runtimeConfig}
            />
          ))}
        </div>

        <div className="settings-editor__section">
          <h3 className="settings-editor__section-title">OpenRouter</h3>
          <div className="settings-editor__note">
            OpenRouter provides access to 400+ models through a single API key.
            Models use the format <code>provider/model-name</code> (e.g., <code>openai/gpt-4.1-mini</code>, <code>anthropic/claude-3.5-sonnet</code>).
          </div>
          <div className="settings-editor__note">
            Set <code>OPENROUTER_API_KEY</code> in your environment to enable.
          </div>
        </div>

        <div className="settings-editor__section">
          <h3 className="settings-editor__section-title">Retry Settings</h3>
          <div className="settings-editor__grid">
            <div className="settings-editor__field">
              <span className="settings-editor__label">Max retries</span>
              <span className="settings-editor__value">{runtimeConfig.retry.max_retries}</span>
            </div>
            <div className="settings-editor__field">
              <span className="settings-editor__label">Base delay</span>
              <span className="settings-editor__value">{runtimeConfig.retry.base_delay_ms}ms</span>
            </div>
          </div>
          <div className="settings-editor__note">
            Set via <code>OPENAUTHOR_PROVIDER_MAX_RETRIES</code> and <code>OPENAUTHOR_PROVIDER_RETRY_BASE_MS</code>.
          </div>
        </div>

        {budget && (
          <div className="settings-editor__section">
            <h3 className="settings-editor__section-title">Budget</h3>
            <div className="settings-editor__grid">
              <div className="settings-editor__field">
                <span className="settings-editor__label">Today</span>
                <span className="settings-editor__value">
                  {budget.usage.daily.total_tokens} tokens / ${budget.usage.daily.estimated_cost_usd.toFixed(4)}
                </span>
              </div>
              <div className="settings-editor__field">
                <span className="settings-editor__label">This week</span>
                <span className="settings-editor__value">
                  {budget.usage.weekly.total_tokens} tokens / ${budget.usage.weekly.estimated_cost_usd.toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function CodexAuthCard({
  config,
  projectRoot,
  onAuthChanged,
  setError,
  setMessage,
}: {
  config: GenerationRuntimeConfig;
  projectRoot: string;
  onAuthChanged: () => Promise<void>;
  setError: (e: string) => void;
  setMessage: (m: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const codexConfig = config.providers["openai-codex"];
  const isConnected = codexConfig.credential_present;

  async function handleLogin() {
    setLoading(true);
    try {
      const result = await authLogin(projectRoot, "openai-codex");
      setMessage(result.message);
      await onAuthChanged();
    } catch (e) {
      setError(`Sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await authLogout(projectRoot, "openai-codex");
      setMessage("Signed out from ChatGPT.");
      await onAuthChanged();
    } catch (e) {
      setError(`Sign-out failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`provider-card provider-card--codex${isConnected ? " provider-card--connected" : ""}`}>
      <div className="provider-card__header">
        <span className={`provider-card__status${isConnected ? " provider-card__status--ok" : ""}`}>
          {isConnected ? "\u2713" : "\u25CB"}
        </span>
        <span className="provider-card__name">ChatGPT Subscription</span>
        <span className="provider-card__model">{codexConfig.default_model}</span>
      </div>
      <div className="provider-card__detail">
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          Use your ChatGPT Plus or Pro subscription. No API key needed.
        </span>
      </div>
      <div className="provider-card__actions">
        {isConnected ? (
          <>
            <span className="provider-card__tag--ok">Authenticated</span>
            <button
              className="btn btn--sm"
              onClick={handleLogout}
              disabled={loading}
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            className="btn btn--primary btn--sm"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? "Opening browser..." : "Sign in with ChatGPT"}
          </button>
        )}
      </div>
    </div>
  );
}


function ProviderCard({
  info,
  config,
}: {
  info: typeof PROVIDER_INFO[number];
  config: GenerationRuntimeConfig;
}) {
  const providerConfig = config.providers[info.id];
  const isConnected = providerConfig.credential_present;
  const baseUrl = "base_url" in providerConfig ? (providerConfig as { base_url?: string }).base_url : undefined;

  return (
    <div className={`provider-card${isConnected ? " provider-card--connected" : ""}`}>
      <div className="provider-card__header">
        <span className={`provider-card__status${isConnected ? " provider-card__status--ok" : ""}`}>
          {isConnected ? "\u2713" : "\u2717"}
        </span>
        <span className="provider-card__name">{info.label}</span>
        <span className="provider-card__model">{providerConfig.default_model}</span>
      </div>
      {info.envVar && (
        <div className="provider-card__detail">
          <code>{info.envVar}</code>
          <span className={isConnected ? "provider-card__tag--ok" : "provider-card__tag--missing"}>
            {isConnected ? "set" : "not set"}
          </span>
        </div>
      )}
      {baseUrl && (
        <div className="provider-card__detail">
          <code className="provider-card__url">{baseUrl}</code>
        </div>
      )}
    </div>
  );
}
