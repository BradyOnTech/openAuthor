import { useEffect, useRef } from "react";

// Focus mode is a presentation of the live SceneEditor, never a second draft.
export function ZenMode({ onExit }: { onExit: () => void }) {
  const exitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const editor = exitRef.current?.closest(".scene-editor");
    if (editor && !editor.contains(document.activeElement)) {
      editor.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
      if (e.key === "Tab" && editor) {
        const controls = Array.from(editor.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'
        ));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <button ref={exitRef} className="zen-mode__exit" aria-label="Exit focus mode" onClick={() => {
      exitRef.current?.closest(".scene-editor")?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
      onExit();
    }}>
      Exit focus mode · Esc
    </button>
  );
}
