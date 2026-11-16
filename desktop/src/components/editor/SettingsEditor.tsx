import { useEffect, useState } from "react";
import { BackupCreate } from "../BackupControls";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { authLogin, authLogout, compactRevisions, exportManuscript, getLocalProductDashboard, getRevisionRetention, pickExportTarget, setRevisionRetention, updateLocalProductSignals, type RevisionRetention } from "../../api";
import type { GenerationRuntimeConfig, LocalProductDashboard, ProposalProvider } from "../../types";
import { setSmartPunctuationEnabled, smartPunctuationEnabled } from "../../smartTypography";
import { DEFAULT_PROSE_SIZE, PROSE_SIZES, proseSize, setProseSize } from "../../proseSize";

const PROVIDER_INFO: {
  id: ProposalProvider;
  label: string;
  envVar: string;
  envUrl?: string;
}[] = [
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", envUrl: "OPENAUTHOR_OPENAI_BASE_URL" },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", envUrl: "OPENAUTHOR_ANTHROPIC_BASE_URL" },
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", envUrl: "OPENAUTHOR_OPENROUTER_BASE_URL" },
  { id: "local", label: "Offline demo (mechanical edits only)", envVar: "" },
];

const GLOSSARY: Array<[string, string]> = [
  ["Scene", "One file of prose. A book is a folder of scenes you can read without openAuthor."],
  ["Revision", "A saved state of the whole book. Every save and every applied change makes one, so anything can be undone."],
  ["Change Set", "A proposed edit, shown as a before and after. Nothing reaches your manuscript until you apply it."],
  ["Hunk", "One passage inside a Change Set. You include, exclude, edit or comment on each one separately."],
  ["Storyline", "A separate copy of the book for trying an idea, such as another ending, without touching the original."],
  ["Story Memory", "What the book has established: people, places, facts and who knows what. The AI is given only what you allow."],
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
        <h2 className="settings-editor__title">Settings</h2>
        <p className="settings-editor__subtitle">
          Connect an AI provider, set how the page behaves while you write, and export or back up your book.
        </p>

        <div className="settings-editor__section">
          <h3 className="settings-editor__section-title">AI provider</h3>
          <div className="settings-editor__note" style={{ marginBottom: "var(--space-2)" }}>
            Sign in with ChatGPT to revise and discuss your book using the plan you already pay for. Without a provider, openAuthor falls back to an offline demo that makes only small rule-based edits.
          </div>
          <CodexAuthCard
            config={runtimeConfig}
            projectRoot={projectRoot}
            onAuthChanged={refreshRuntimeConfig}
            setError={setError}
            setMessage={setMessage}
          />
        </div>


        <WritingPreferencesCard />

        <ManuscriptExportCard
          projectRoot={projectRoot}
          setError={setError}
          setMessage={setMessage}
        />

        <BackupCreate projectRoot={projectRoot} setError={setError} setMessage={setMessage} />

        <HistoryCard projectRoot={projectRoot} setError={setError} setMessage={setMessage} />

        <details className="settings-editor__advanced">
          <summary>Advanced: API-key providers, retries and usage</summary>
          <div className="settings-editor__note" style={{ marginTop: "var(--space-3)" }}>
            API-key providers are read from environment variables when openAuthor starts. An app opened from Finder or the Dock does not see variables set in a shell profile; start openAuthor from a terminal, or use ChatGPT sign-in above.
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
        </details>

        <div className="settings-editor__section">
          <h3 className="settings-editor__section-title">How openAuthor names things</h3>
          <div className="settings-editor__note">
            openAuthor borrows its working method from software engineering, where every change is proposed, reviewed and reversible. The names follow.
          </div>
          <dl className="settings-editor__glossary">
            {GLOSSARY.map(([term, meaning]) => <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>)}
          </dl>
        </div>

        <LocalActivityCard projectRoot={projectRoot} setError={setError} />
      </div>
    </div>
  );
}

function WritingPreferencesCard() {
  const [smart, setSmart] = useState(smartPunctuationEnabled);
  const [size, setSize] = useState(proseSize);
  useEffect(() => {
    const follow = (event: Event) => setSize((event as CustomEvent<number>).detail);
    window.addEventListener("openauthor-prose-size", follow);
    return () => window.removeEventListener("openauthor-prose-size", follow);
  }, []);
  return (
    <div className="settings-editor__section">
      <h3 className="settings-editor__section-title">Writing</h3>
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 40 }}>
        <input type="checkbox" checked={smart} onChange={(event) => { setSmart(event.target.checked); setSmartPunctuationEnabled(event.target.checked); }} />
        Smart punctuation while typing
      </label>
      <div className="settings-editor__note">
        Turns straight quotes into curly quotes and two hyphens into an em dash as you type. Existing text is never changed, and Undo restores what you typed.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minHeight: 40, marginTop: "var(--space-2)" }}>
        Text size on the page
        <select className="select" value={size} onChange={(event) => setSize(setProseSize(Number(event.target.value)))} aria-label="Text size on the page">
          {PROSE_SIZES.map(option => <option key={option} value={option}>{option} px{option === DEFAULT_PROSE_SIZE ? " (standard)" : ""}</option>)}
        </select>
      </label>
      <div className="settings-editor__note">
        Changes the prose only: on the page, in focus mode and in Read manuscript. Cmd+Plus and Cmd+Minus do the same from the keyboard; Cmd+0 returns to the standard size.
      </div>
      <div className="settings-editor__grid" style={{ marginTop: "var(--space-3)" }}>
        {[["Italic", "Cmd+I"], ["Find and replace in a scene", "Cmd+F"], ["Next / previous match", "Cmd+G / Cmd+Shift+G"], ["Focus mode", "Cmd+Shift+D"], ["New scene", "Cmd+N"], ["Close tab", "Cmd+W"]].map(([label, keys]) => (
          <div className="settings-editor__field" key={label}><span className="settings-editor__label">{label}</span><span className="settings-editor__value">{keys}</span></div>
        ))}
      </div>
      <div className="settings-editor__note">
        Every shortcut is also in the menu bar. Scenes are plain Markdown files: italic is stored as <code>*word*</code> and bold is typed as <code>**word**</code>. Both carry through Word import and export and show as emphasis in Read manuscript.
      </div>
    </div>
  );
}

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function HistoryCard({ projectRoot, setError, setMessage }: { projectRoot: string; setError: (value: string) => void; setMessage: (value: string) => void }) {
  const [retention, setRetention] = useState<RevisionRetention | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setRetention(null);
    void getRevisionRetention(projectRoot).then(row => { if (current) setRetention(row); }).catch(() => {
      // An engine without retention simply shows no history controls.
    });
    return () => { current = false; };
  }, [projectRoot]);
  if (!retention) return null;

  async function toggle(enabled: boolean) {
    const previous = retention;
    // The switch answers at once; the book confirms, or the switch goes back.
    setRetention(current => current && { ...current, policy: { ...current.policy, enabled } });
    try {
      setRetention(await setRevisionRetention(projectRoot, enabled));
    } catch (error) {
      setRetention(previous);
      setError(`History setting could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function thinNow() {
    setBusy(true);
    try {
      let removed = 0;
      // Large backlogs are worked off in bounded passes so saving is never held up.
      for (let pass = 0; pass < 20; pass += 1) {
        const result = await compactRevisions(projectRoot);
        removed += result.removed_revisions;
        if (!result.ran || result.complete) break;
      }
      setRetention(await getRevisionRetention(projectRoot));
      setMessage(removed ? `Thinned ${removed.toLocaleString()} old automatic save${removed === 1 ? "" : "s"}.` : "Nothing old enough to thin yet.");
    } catch (error) {
      setError(`History could not be thinned: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  }

  const { policy, store, last_run: lastRun } = retention;
  return (
    <div className="settings-editor__section">
      <h3 className="settings-editor__section-title">History</h3>
      <div className="settings-editor__note">
        Every save is kept as a Revision. This book holds {store.revisions.toLocaleString()} of them, using {megabytes(store.allocated_bytes)} on disk.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 40 }}>
        <input type="checkbox" checked={policy.enabled} disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
        Thin old automatic saves
      </label>
      <div className="settings-editor__note">
        Everything from the last {policy.keep_all_days} days is kept. Older automatic saves are reduced to one per hour, and after {policy.daily_after_days} days to one per day.
        Versions you named, every applied or undone Change Set, imports, restores and Storyline changes are never removed. Turn this off to keep every automatic save forever.
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-3)", marginTop: "var(--space-2)" }}>
        <button className="btn btn--sm" style={{ minHeight: 40 }} disabled={busy || !policy.enabled} onClick={() => void thinNow()}>{busy ? "Working…" : "Thin now"}</button>
        <span className="settings-editor__note" style={{ margin: 0 }}>
          {lastRun.at
            ? `Last thinned ${new Date(lastRun.at).toLocaleDateString()}${lastRun.removed_revisions ? `, removing ${lastRun.removed_revisions.toLocaleString()} and freeing ${megabytes(lastRun.freed_bytes)}` : ""}.`
            : "Not thinned yet. It runs by itself about once a day while the book is open."}
        </span>
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
