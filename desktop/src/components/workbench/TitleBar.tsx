import { useEffect } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useProjectName } from "../../hooks/useProjectName";
import { hasOverlayTitleBar, trackWindowFocus } from "../../nativeWindow";

/**
 * The strip under the Mac window buttons: it names the open book and is the
 * handle the window is dragged by. Rendered only where the page owns the top
 * edge of the window; see `nativeWindow.ts`.
 */
export function TitleBar() {
  const overlay = hasOverlayTitleBar();
  const { projectFound } = useWorkspace();
  const projectName = useProjectName();
  useEffect(() => (overlay ? trackWindowFocus() : undefined), [overlay]);
  if (!overlay) return null;
  const title = projectFound === true ? projectName : "";
  // The status bar already names the book for assistive technology.
  return (
    <div className={`titlebar${title ? "" : " titlebar--plain"}`} data-tauri-drag-region aria-hidden="true">
      {title && <span className="titlebar__title">{title}</span>}
    </div>
  );
}
