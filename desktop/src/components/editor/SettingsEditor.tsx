import { useEffect, useState } from "react";
import { BackupCreate } from "../BackupControls";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { authLogin, authLogout, exportManuscript, getLocalProductDashboard, pickExportTarget, updateLocalProductSignals } from "../../api";
import type { GenerationRuntimeConfig, LocalProductDashboard, ProposalProvider } from "../../types";

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

        <ManuscriptExportCard
          projectRoot={projectRoot}
          setError={setError}
          setMessage={setMessage}
        />

        <LocalActivityCard projectRoot={projectRoot} setError={setError} />
        <BackupCreate projectRoot={projectRoot} setError={setError} setMessage={setMessage} />

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

function LocalActivityCard({ projectRoot, setError }: { projectRoot: string; setError: (value: string) => void }) {
  const [dashboard, setDashboard] = useState<LocalProductDashboard | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setDashboard(await getLocalProductDashboard(projectRoot));
    } catch (error) {
      setError(`Local activity dashboard failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => { void load(); }, [projectRoot]);

  async function toggleSignals() {
    if (!dashboard) return;
    setBusy(true);
    try {
      await updateLocalProductSignals(projectRoot, !dashboard.privacy.local_signals_enabled);
      await load();
    } catch (error) {
      setError(`Local activity setting failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const milestones = dashboard?.activation;
  return (
    <div className="settings-editor__section">
      <h3 className="settings-editor__section-title">Private Product Dashboard</h3>
      <div className="settings-editor__note">
        These content-free signals stay inside this project. They never include manuscript text, titles, prompts, names, paths, or project identifiers, and openAuthor has no external telemetry transport.
      </div>
      {dashboard && (
        <>
          <div className="settings-editor__grid" style={{ marginTop: "var(--space-3)" }}>
            <div className="settings-editor__field"><span className="settings-editor__label">Golden loop</span><span className="settings-editor__value">{milestones?.golden_loop_completed ? "Completed" : "In progress"}</span></div>
            <div className="settings-editor__field"><span className="settings-editor__label">Active days</span><span className="settings-editor__value">{dashboard.active_days}</span></div>
            <div className="settings-editor__field"><span className="settings-editor__label">Reviewed hunks</span><span className="settings-editor__value">{dashboard.trust.accepted_hunks + dashboard.trust.rejected_hunks}</span></div>
            <div className="settings-editor__field"><span className="settings-editor__label">Apply / undo</span><span className="settings-editor__value">{dashboard.trust.applied_change_sets} / {dashboard.trust.undone_change_sets}</span></div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "var(--space-3)" }}>
            {(["scene_created", "change_reviewed", "change_applied", "change_undone"] as const).map((key) => <span className={`badge badge--${milestones?.[key] ? "applied" : "warning"}`} key={key}>{milestones?.[key] ? "✓" : "○"} {key.replace(/_/g, " ")}</span>)}
          </div>
          <button className="btn btn--sm" disabled={busy} onClick={() => void toggleSignals()} style={{ marginTop: "var(--space-3)" }}>
            {dashboard.privacy.local_signals_enabled ? "Pause on-device signals" : "Enable on-device signals"}
          </button>
        </>
      )}
    </div>
  );
}

function ManuscriptExportCard({
  projectRoot,
  setError,
  setMessage,
}: {
  projectRoot: string;
  setError: (value: string) => void;
  setMessage: (value: string) => void;
}) {
  const [format, setFormat] = useState<"markdown" | "docx">("docx");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportReport, setExportReport] = useState<Awaited<ReturnType<typeof exportManuscript>> | null>(null);

  async function browse() {
    try {
      const selected = await pickExportTarget(format, target || undefined);
      if (selected) setTarget(selected);
    } catch (error) { setError(`Cannot choose export destination: ${String(error)}`); }
  }

  async function runExport() {
    if (!target.trim()) return;
    setBusy(true);
    setError("");
    setExportReport(null);
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before exporting.");
      const report = await exportManuscript(projectRoot, target.trim(), format);
      setExportReport(report);
      const lossSummary = report.losses.length
        ? ` ${report.losses.length} limitation${report.losses.length === 1 ? "" : "s"} recorded in the loss report.`
        : " No additional limitations reported.";
      setMessage(`Exported ${report.scene_count} scenes.${lossSummary}`);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-editor__section">
      <h3 className="settings-editor__section-title">Manuscript Export</h3>
      <div className="settings-editor__note">
        Export saved prose and reading order. Unsaved scene writing is saved first. This is not a full backup: Plan notes, Story Memory, AI work and version history are not included. Every export writes a loss report beside the output.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
        <select className="select" style={{ minHeight: 40 }} disabled={busy} value={format} onChange={(event) => { setFormat(event.target.value as "markdown" | "docx"); setTarget(""); }} aria-label="Export format">
          <option value="docx">Word (.docx)</option>
          <option value="markdown">Markdown folder</option>
        </select>
        <input className="input input--mono" aria-label="Export destination" disabled={busy} value={target} onChange={(event) => setTarget(event.target.value)} placeholder={format === "docx" ? "/path/to/manuscript.docx" : "/path/to/empty-folder"} style={{ flex: "1 1 200px", minHeight: 40 }} />
        <button className="btn btn--ghost btn--sm" style={{ minHeight: 40 }} disabled={busy} onClick={() => void browse()}>Browse</button>
        <button className="btn btn--primary btn--sm" style={{ minHeight: 40 }} disabled={!target.trim() || busy} onClick={() => void runExport()}>
          {busy ? "Exporting..." : "Export"}
        </button>
      </div>
      {exportReport && <section aria-label="Export loss report" style={{ overflowWrap: "anywhere", marginTop: 12 }}>
        <p role="status">Exported {exportReport.scene_count} scenes to {exportReport.target}.</p>
        <ul>{exportReport.losses.map(loss => <li key={loss}>{loss}</li>)}</ul>
        <p>Report file: <code>{exportReport.report_path}</code></p>
      </section>}
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
  const runtimeAvailable = codexConfig.runtime_available;
  const modelLabel = codexConfig.default_model === "codex-recommended"
    ? "Codex recommended"
    : codexConfig.default_model;
  const planLabel = codexConfig.plan_type
    ? codexConfig.plan_type.replace(/_/g, " ")
    : "ChatGPT plan";

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
        <span className="provider-card__model">{modelLabel}</span>
      </div>
      <div className="provider-card__detail">
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          Uses your ChatGPT/Codex plan through openAuthor&apos;s local Codex app-server.
          openAuthor never reads or stores the OpenAI OAuth tokens itself.
        </span>
      </div>
      {isConnected && (
        <div className="provider-card__detail">
          <span className="provider-card__tag--ok">{planLabel}</span>
          {codexConfig.email && <span>{codexConfig.email}</span>}
        </div>
      )}
      {!runtimeAvailable && (
        <div className="provider-card__detail">
          <span className="provider-card__tag--missing">Codex runtime unavailable</span>
          <span>Install Codex or set <code>OPENAUTHOR_CODEX_BIN</code>.</span>
        </div>
      )}
      {codexConfig.error && (
        <div className="provider-card__detail">
          <span style={{ fontSize: "var(--text-xs)", color: "var(--danger)" }}>
            {codexConfig.error}
          </span>
        </div>
      )}
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
            disabled={loading || !runtimeAvailable}
          >
            {loading ? "Opening browser..." : "Sign in with ChatGPT"}
          </button>
        )}
      </div>
      <div className="settings-editor__note" style={{ marginTop: "var(--space-2)" }}>
        Usage follows your ChatGPT plan limits. This login is isolated from the Codex CLI
        and other apps on this Mac.
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
