import type { RevisionContextPreview } from "../../api";
import { WritingBriefDirection } from "./WritingBriefDirection";

export function WritingBriefPreview({ preview }: { preview: RevisionContextPreview }) {
  const context = preview.context, brief = context.writing_brief;
  if (!brief) return null;
  const plan = context.story_plan, voice = context.writing_voice;
  return <section aria-label="Assembled writing brief" style={{ display: "grid", gap: 10, padding: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
    <h4 style={{ margin: 0 }}>Writing brief · {context.scene.title || context.scene.id}</h4>
    <p style={{ margin: 0 }}>Viewpoint: {brief.pov || "not specified"} · Story time: {brief.story_time || "not specified"}</p>
    {brief.scene_summary && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>Saved scene summary: {brief.scene_summary}</p>}
    <WritingBriefDirection value={brief.direction} permission={brief.change_permission} />
    <details><summary>Book direction and planned beats</summary>
      {plan.brief && Object.entries(plan.brief).map(([key, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)) && <div key={key}>
        <strong>{key === "style_guide" ? "Style guide" : key[0].toUpperCase() + key.slice(1)}</strong>
        <p style={{ whiteSpace: "pre-wrap" }}>{Array.isArray(value) ? value.join(", ") : value}</p>
      </div>)}
      {plan.structure?.map(act => <div key={act.id}><strong>{act.title}</strong><p>{act.synopsis}</p>
        {act.chapters.map(chapter => <div key={chapter.id}><strong>{chapter.title}</strong><p>{chapter.synopsis}</p></div>)}</div>)}
      {plan.beats?.map((beat, index) => <p key={index}>{beat.status}: {beat.summary}</p>)}
      {!plan.brief?.synopsis && !plan.brief?.outline && !plan.beats?.length && <p>No synopsis, outline or scene beats are included.</p>}
    </details>
    <details><summary>Writing Voice · {brief.source_status.voice_excerpts} approved excerpts</summary>
      {voice ? <><strong>{voice.name}</strong><p>{voice.description}</p>
        {voice.guidance.map((line, index) => <p key={index}>{line}</p>)}
        {voice.avoid.length > 0 && <p>Avoid: {voice.avoid.join("; ")}</p>}
        {voice.observations?.map((row, index) => <div key={index}><strong>{row.aspect} · {row.scene_id}</strong>
          <blockquote style={{ whiteSpace: "pre-wrap" }}>{row.excerpt}</blockquote><p>{row.observation}</p></div>)}
      </> : <p>No current approved Writing Voice is included. Choose and approve examples in Writing Voice.</p>}
    </details>
    <details><summary>Story Memory used · {brief.source_status.memory_entries} entries</summary>
      {context.codex_entities.map(entry => <div key={entry.id}><strong>{entry.name} · {entry.type}</strong><p style={{ whiteSpace: "pre-wrap" }}>{entry.description}</p>
        {entry.details?.map((detail, index) => <p key={index}>{detail.key}: {typeof detail.value === "string" ? detail.value : JSON.stringify(detail.value)}</p>)}</div>)}
      <p>Only permitted entries are shown. Canon selections and their character knowledge are reviewed below.</p>
    </details>
    <details><summary>Prose used for continuity</summary>
      {context.preceding_prose?.map(scene => <div key={scene.id}><strong>Preceding scene: {scene.title} · {scene.pov}</strong>
        <p>{scene.omitted_characters ? `${scene.omitted_characters.toLocaleString()} earlier characters omitted; the ending is included.` : "Complete preceding scene included."}</p>
        <div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)" }}>{scene.body}</div></div>)}
      {context.nearby_scenes?.map(scene => <div key={scene.id}><strong>Nearby scene: {scene.title}</strong><div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)" }}>{scene.body}</div></div>)}
      {!context.preceding_prose?.length && !context.nearby_scenes?.length && <p>No other scene prose is included.</p>}
    </details>
    {brief.warnings.length > 0 && <details open><summary>Missing writing direction</summary>
      {brief.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <p>You can edit the brief or continue with these gaps. Generation does not fill them into approved book facts.</p>
    </details>}
  </section>;
}
