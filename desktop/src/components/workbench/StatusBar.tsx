import { useUI } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";

export function StatusBar() {
  const { theme, toggleTheme } = useUI();
  const { projectRoot, projectFound, scenes, branches, budget } = useWorkspace();

  const projectName = projectRoot ? projectRoot.split("/").pop() || "Project" : "No Project";
  const sceneCount = scenes.length;
  const wordCount = 0; // will be computed from scene data later
  const currentBranch = branches.find((b) => b.current)?.name ?? "—";

  const dailyTokensUsed = budget?.usage?.daily?.total_tokens ?? 0;
  const dailyTokensLimit = budget?.policy?.rolling?.daily_tokens ?? null;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span className="status-bar__item">
          {projectFound === true
            ? projectName
            : projectFound === false
              ? "No Project"
              : "..."}
        </span>
        {projectFound && (
          <>
            <span className="status-bar__divider" />
            <span className="status-bar__item status-bar__mono">
              {sceneCount} scene{sceneCount !== 1 ? "s" : ""}
            </span>
            {wordCount > 0 && (
              <>
                <span className="status-bar__divider" />
                <span className="status-bar__item status-bar__mono">
                  {wordCount.toLocaleString()} words
                </span>
              </>
            )}
            <span className="status-bar__divider" />
            <span className="status-bar__item status-bar__mono">
              {currentBranch}
            </span>
          </>
        )}
      </div>
      <div className="status-bar__right">
        {dailyTokensLimit && (
          <span className="status-bar__item status-bar__mono">
            {dailyTokensUsed.toLocaleString()}/{dailyTokensLimit.toLocaleString()} tokens
          </span>
        )}
        <span
          className="status-bar__item status-bar__item--clickable"
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? "\u263D" : "\u2600"}
        </span>
      </div>
    </div>
  );
}
