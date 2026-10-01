import { useEffect, useRef, useState } from "react";
import { buildStyleProfile, getStyleProfile, setStyleProfileReference, type StyleProfile } from "../../api";
import { withBookMetadataWrite } from "../../bookOperationBarrier";
import { flushProjectSceneSaves } from "../../sceneSaveSession";

type Props = { projectRoot: string; scenes: Array<{ id: string; title: string }>; disabled?: boolean };

export function StyleProfilePanel({ projectRoot, scenes, disabled = false }: Props) {
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const lifecycle = useRef({ alive: true, request: 0 });
  const pending = useRef(false);
  useEffect(() => {
    const view = { alive: true, request: 0 };
    lifecycle.current = view;
    return () => { view.alive = false; };
  }, [projectRoot]);
  useEffect(() => {
    const view = lifecycle.current;
    const request = ++view.request;
    setLoading(true);
    void getStyleProfile(projectRoot).then(next => {
      if (!view.alive || view.request !== request) return;
      setProfile(next); setError("");
      if (!choosing) setSelected(next?.exemplar_scene_ids ?? []);
    }).catch(cause => { if (view.alive && view.request === request) setError(String(cause)); })
      .finally(() => { if (view.alive && view.request === request) setLoading(false); });
  }, [projectRoot, scenes, refresh]);

  async function mutate(action: "build" | "current" | "frozen") {
    if (pending.current || disabled || loading || error) return;
    pending.current = true; setSaving(true);
    const view = lifecycle.current;
    ++view.request;
    try {
      const next = await withBookMetadataWrite(projectRoot, async () => {
        if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending prose before updating the Style Profile.");
        return action === "build" ? buildStyleProfile(projectRoot, selected, profile?.fingerprint ?? "")
          : setStyleProfileReference(projectRoot, action, profile!.fingerprint);
      });
      ++view.request;
      if (view.alive) { setProfile(next); setSelected(next.exemplar_scene_ids); setChoosing(false); setError(""); }
    } catch (cause) {
      ++view.request;
      if (view.alive) setError(`${cause instanceof Error ? cause.message : String(cause)} Refresh the profile before trying again.`);
    } finally {
      pending.current = false;
      if (view.alive) { setSaving(false); setLoading(false); }
    }
  }

  const blocked = disabled || loading || saving || Boolean(error);
  const title = (id: string) => scenes.find(scene => scene.id === id)?.title || `${id} (unavailable)`;
  const status = !profile ? "Choose scenes whose voice you want to retain."
    : profile.freshness === "unknown" ? "Legacy profile · excluded from AI until rebuilt with verified sources."
    : profile.reference_mode === "frozen" ? "Frozen reference · included in AI as deliberately retained measurements, not current story facts."
    : profile.freshness === "stale" ? "Changed sources · excluded from AI until rebuilt or deliberately frozen."
    : "Current sources · included in edit plans, scene drafts and passage revisions.";
  return <section aria-label="Your Style Profile" style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", display: "grid", gap: 12, color: "var(--text-secondary)" }}>
    <strong style={{ color: "var(--text-primary)" }}>Your Style Profile</strong>
    <p role="status" style={{ margin: 0 }}>{loading ? "Checking Style Profile sources…" : status}</p>
    {error && <p role="alert">{error}</p>}
    {profile && <>
      {profile.changed_scene_ids.length > 0 && <p>Changed or unavailable: {profile.changed_scene_ids.map(title).join(", ")}.</p>}
      <p>Measurements describe selected exemplars; they are not writing targets or a voice-quality score.</p>
      {profile.measurement?.limitations.map(value => <small key={value}>{value}</small>)}
      <details><summary style={{ minHeight: 40, cursor: "pointer" }}>Inspect saved measurements and source versions</summary>
        <p>Built {new Date(profile.created_at).toLocaleString()}.</p>
        <p style={{ fontVariantNumeric: "tabular-nums" }}>{profile.measurement?.word_metrics_available ? `${profile.metrics.word_count?.toLocaleString()} approximate lexical words` : "Word-based measurements unavailable"}{profile.metrics.character_count != null ? ` · ${profile.metrics.character_count.toLocaleString()} characters` : ""}.</p>
        {profile.schema_version === 2 && profile.guidance.map(value => <p key={value}>{value}</p>)}
        {profile.exemplar_scene_ids.map(id => <p key={id} style={{ overflowWrap: "anywhere" }}>{title(id)} · source {profile.source_digests?.[id] ?? "not recorded"}</p>)}
      </details>
    </>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button className="btn" style={{ minHeight: 40 }} disabled={disabled || loading || saving} onClick={() => setRefresh(value => value + 1)}>Refresh profile</button>
      <button className="btn" style={{ minHeight: 40 }} disabled={blocked} onClick={() => setChoosing(value => !value)}>{choosing ? "Close exemplar selection" : profile ? "Change Exemplars" : "Choose Exemplars"}</button>
      {profile && <button className="btn" style={{ minHeight: 40 }} disabled={blocked || selected.length === 0} onClick={() => void mutate("build")}>Rebuild from selected scenes</button>}
      {profile && profile.freshness !== "unknown" && <button className="btn" style={{ minHeight: 40 }} disabled={blocked} onClick={() => void mutate(profile.reference_mode === "frozen" ? "current" : "frozen")}>{profile.reference_mode === "frozen" ? "Require current sources" : "Use saved metrics as frozen reference"}</button>}
    </div>
    {choosing && <fieldset disabled={blocked} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend>Select only your intended voice exemplars</legend>
      {scenes.map(scene => <label key={scene.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, overflowWrap: "anywhere" }}><input type="checkbox" checked={selected.includes(scene.id)} onChange={event => setSelected(event.target.checked ? [...selected, scene.id] : selected.filter(id => id !== scene.id))} />{scene.title}</label>)}
      <button className="btn btn--primary" style={{ minHeight: 40 }} disabled={selected.length === 0} onClick={() => void mutate("build")}>Build Style Profile</button>
    </fieldset>}
  </section>;
}
