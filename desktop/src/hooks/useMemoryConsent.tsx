import { useCallback, useEffect, useRef, useState } from "react";
import { getCodexEntity } from "../api";

type Permission = { ids: string[]; names: string[]; resolve: (ids: string[] | null) => void };

/** One-request author consent, independent of model arguments and saved profiles. */
export function useMemoryConsent(projectRoot: string, threadId: string) {
  const [permission, setPermission] = useState<Permission | null>(null);
  const [pending, setPending] = useState(false);
  const active = useRef<Permission | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPermission(null);
    setPending(false);
    busy.current = false;
    return () => {
      generation.current += 1;
      active.current?.resolve(null);
      active.current = null;
    };
  }, [projectRoot, threadId]);

  useEffect(() => { if (permission) cancelButton.current?.focus(); }, [permission]);

  const requestApproval = useCallback(async (entityIds: string[]): Promise<string[] | null> => {
    if (busy.current) return null;
    busy.current = true;
    const request = ++generation.current;
    setPending(true);
    try {
      const entities = await Promise.all([...new Set(entityIds)].map((id) => getCodexEntity(projectRoot, id)));
      if (generation.current !== request) return null;
      const excluded = entities.find((entity) => entity.ai_visibility === "exclude");
      if (excluded) throw new Error(`“${excluded.name}” is excluded from AI context. Remove that reference or change its access in Story Memory.`);
      const asking = entities.filter((entity) => entity.ai_visibility === "ask" || entity.details?.some((detail) => detail.ai_visibility === "ask"));
      if (!asking.length) return [];
      return await new Promise((resolve) => {
        const prompt = { ids: asking.map((entity) => entity.id), names: asking.map((entity) => entity.name), resolve };
        active.current = prompt;
        setPermission(prompt);
      });
    } finally {
      if (generation.current === request) {
        busy.current = false;
        setPending(false);
        setPermission(null);
        active.current = null;
      }
    }
  }, [projectRoot, threadId]);

  function decide(allow: boolean) {
    const prompt = active.current;
    if (prompt) prompt.resolve(allow ? prompt.ids : null);
  }

  const review = permission && <section className="chat-memory-permission" aria-label="Story Memory permission" onKeyDown={(event) => { if (event.key === "Escape") decide(false); }}>
    <h3>Allow Memory for this request?</h3>
    <p>{permission.names.join(", ")}</p>
    <p>This includes details marked “Ask before using.” Private author notes and excluded details stay out. Replies may remain in chat history.</p>
    <div><button className="btn btn--sm" ref={cancelButton} onClick={() => decide(false)}>Cancel</button><button className="btn btn--primary btn--sm" onClick={() => decide(true)}>Allow for this request</button></div>
  </section>;
  return { requestApproval, pending, review };
}
