import { useRef, useState } from "react";
import { DraftJournal, type RetainedRecord } from "../workspaceRetention";

/** Mount with a key for this book/Storyline/resource. Writes happen at the edit event. */
export function useRetainedDraft<T>(key: string, initial: T, valid: (value: unknown) => value is T) {
  const [journal] = useState(() => new DraftJournal(key, valid));
  const [loaded] = useState(() => {
    try { return { rows: journal.read(), warning: "" }; }
    catch (error) { return { rows: [] as RetainedRecord<T>[], warning: `Local recovery is unavailable: ${String(error)}` }; }
  });
  const [value, setValue] = useState<T>(loaded.rows[0]?.value ?? initial);
  const current = useRef(value);
  const own = useRef<RetainedRecord<T> | undefined>(undefined);
  const recovered = useRef<RetainedRecord<T> | undefined>(loaded.rows[0]);
  const [warning, setWarning] = useState(loaded.warning);
  const [restored, setRestored] = useState(!!loaded.rows.length);
  const [alternatives, setAlternatives] = useState(loaded.rows.slice(1));

  function change(next: T | ((old: T) => T)) {
    const changed = typeof next === "function" ? (next as (old: T) => T)(current.current) : next;
    current.current = changed; setValue(changed);
    try {
      if (JSON.stringify(changed) === JSON.stringify(initial)) {
        if (own.current) journal.retire(own.current);
        if (recovered.current) journal.retire(recovered.current);
        own.current = undefined; recovered.current = undefined;
        setRestored(false); setWarning("");
        return;
      }
      own.current = journal.write(changed, own.current);
      if (recovered.current) { journal.retire(recovered.current); recovered.current = undefined; }
      setWarning("");
    } catch { setWarning("Could not retain this draft locally. Keep this screen open and save or copy your work before leaving."); }
  }

  function discard() {
    try {
      if (own.current) journal.retire(own.current);
      if (recovered.current) journal.retire(recovered.current);
      own.current = undefined; recovered.current = undefined;
      current.current = initial; setValue(initial); setRestored(false); setWarning("");
    } catch { setWarning("Could not discard the local copy. Your draft remains available."); }
  }

  function restore(row: RetainedRecord<T>) {
    let previousCopy = own.current || recovered.current;
    if (previousCopy && JSON.stringify(previousCopy.value) !== JSON.stringify(current.current)) {
      try { previousCopy = journal.write(current.current, own.current); }
      catch { setWarning("Could not retain the current draft. Save or copy it before recovering another copy."); return; }
    }
    setAlternatives((previous) => [...previous.filter((item) => item.owner !== row.owner), ...(previousCopy ? [previousCopy] : [])]);
    own.current = undefined; recovered.current = row;
    current.current = row.value; setValue(row.value); setRestored(true);
  }
  return { value, change, discard, restore, alternatives, warning, restored };
}
