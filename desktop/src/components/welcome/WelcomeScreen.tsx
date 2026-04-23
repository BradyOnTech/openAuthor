import { useCallback, useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { getProjectStatus, pickFolder, pickZipFile } from "../../api";
import { getProjectBinding } from "../../projectBindings";

function isDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type NewProjectForm = {
  name: string;
  savePath: string;
  importKind: "none" | "folder" | "zip";
  importPath: string;
  showImport: boolean;
};

type OpenProjectState =
  | { kind: "idle" }
  | { kind: "not-found"; path: string; name: string };

async function webPickFolder(): Promise<string | null> {
  if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
    try {
      const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      return handle.name;
    } catch {
      return null;
    }
  }
  return null;
}

async function browseFolder(startingPath?: string): Promise<string | null> {
  const tauriResult = await pickFolder(startingPath);
  if (tauriResult) return tauriResult;
  if (isDesktopRuntime()) return null;
  return webPickFolder();
}

function webPickFile(accept?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    let resolved = false;
    input.addEventListener("change", () => {
      resolved = true;
      const file = input.files?.[0];
      resolve(file ? file.name : null);
      document.body.removeChild(input);
    });
    input.addEventListener("cancel", () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
        document.body.removeChild(input);
      }
    });
    input.click();
  });
}

async function browseZipFile(startingPath?: string): Promise<string | null> {
  const tauriResult = await pickZipFile(startingPath);
  if (tauriResult) return tauriResult;
  if (isDesktopRuntime()) return null;
  return webPickFile(".zip");
}

export function WelcomeScreen() {
  const {
    projects,
    openProject,
    createAndOpenProject,
    attachProjectRoot,
    busy,
    error,
    message,
    setError,
    setMessage,
  } = useWorkspace();
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState<NewProjectForm>({
    name: "",
    savePath: "",
    importKind: "none",
    importPath: "",
    showImport: false,
  });
  const [openState, setOpenState] = useState<OpenProjectState>({ kind: "idle" });
  const [notFoundName, setNotFoundName] = useState("");
  const [notFoundPath, setNotFoundPath] = useState("");

  const recentProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === "active")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [projects]);

  const handleNewProject = useCallback(() => {
    setShowNewForm(true);
    setOpenState({ kind: "idle" });
  }, []);

  const handleCreate = useCallback(async () => {
    const importSource = form.importKind !== "none" && form.importPath.trim()
      ? { kind: form.importKind as "folder" | "zip", path: form.importPath.trim() }
      : undefined;
    const ok = await createAndOpenProject({
      name: form.name,
      savePath: form.savePath,
      importSource,
    });
    if (ok) {
      setShowNewForm(false);
      setForm({ name: "", savePath: "", importKind: "none", importPath: "", showImport: false });
    }
  }, [createAndOpenProject, form]);

  const handleOpenProject = useCallback(async () => {
    const selectedPath = await browseFolder();
    if (!selectedPath) return;

    try {
      const status = await getProjectStatus(selectedPath);
      if (status.found) {
        const attached = await attachProjectRoot(status.project_root || selectedPath);
        if (!attached) {
          setError("Failed to open the selected project folder.");
        }
      } else {
        const leaf = selectedPath.split(/[/\\]/).pop() || "Untitled";
        setOpenState({ kind: "not-found", path: selectedPath, name: leaf });
        setNotFoundName(leaf);
        setNotFoundPath(selectedPath);
        setShowNewForm(false);
      }
    } catch (e) {
      setError(`Failed to open: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [attachProjectRoot, setError]);

  const handleCreateFromNotFound = useCallback(async () => {
    const ok = await createAndOpenProject({
      name: notFoundName,
      savePath: notFoundPath,
    });
    if (ok) {
      setOpenState({ kind: "idle" });
    }
  }, [createAndOpenProject, notFoundName, notFoundPath]);

  const handleRecentClick = useCallback((projectId: string) => {
    void openProject(projectId);
  }, [openProject]);

  const handleBrowseSavePath = useCallback(async () => {
    const selected = await browseFolder(form.savePath || undefined);
    if (selected) {
      setForm((prev) => ({ ...prev, savePath: selected }));
    }
  }, [form.savePath]);

  const handleBrowseImportPath = useCallback(async () => {
    if (form.importKind === "zip") {
      const selected = await browseZipFile(form.importPath || undefined);
      if (selected) setForm((prev) => ({ ...prev, importPath: selected }));
    } else {
      const selected = await browseFolder(form.importPath || undefined);
      if (selected) setForm((prev) => ({ ...prev, importPath: selected }));
    }
  }, [form.importKind, form.importPath]);

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-base)",
      zIndex: 500,
    }}>
      {(error || message) && (
        <div style={{
          position: "fixed",
          top: "var(--space-2)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 700,
          padding: "var(--space-2) var(--space-4)",
          borderRadius: "var(--radius-md)",
          fontSize: "var(--text-sm)",
          maxWidth: "500px",
          background: error ? "var(--danger-subtle)" : "var(--success-subtle)",
          border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`,
          color: error ? "var(--danger-text)" : "var(--success-text)",
          cursor: "pointer",
        }} onClick={() => { setError(""); setMessage(""); }}>
          {error || message}
        </div>
      )}

      <div style={{
        width: "100%",
        maxWidth: 560,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
        padding: "var(--space-6)",
      }}>
        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{
            fontFamily: "var(--font-prose)",
            fontSize: "var(--text-3xl)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-primary)",
            margin: 0,
          }}>
            openAuthor
          </h1>
          <p style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-tertiary)",
            margin: "var(--space-2) 0 0 0",
          }}>
            Choose a project to begin writing.
          </p>
        </div>

        {/* Primary actions */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-3)",
        }}>
          <button
            className="btn btn--primary"
            style={{ padding: "var(--space-3) var(--space-4)" }}
            onClick={handleNewProject}
            disabled={busy}
          >
            New Project
          </button>
          <button
            className="btn btn--ghost"
            style={{ padding: "var(--space-3) var(--space-4)" }}
            onClick={() => void handleOpenProject()}
            disabled={busy}
          >
            Open Project
          </button>
        </div>

        {/* Not-found prompt (from Open Project) */}
        {openState.kind === "not-found" && (
          <div style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0 }}>
              No project found at this location. Create one here?
            </p>
            <div style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-ghost)",
              fontFamily: "var(--font-mono)",
              wordBreak: "break-all",
            }}>
              {openState.path}
            </div>
            <input
              className="input"
              placeholder="Project name"
              value={notFoundName}
              onChange={(e) => setNotFoundName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && notFoundName.trim()) {
                  void handleCreateFromNotFound();
                }
              }}
            />
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                className="btn btn--primary"
                disabled={!notFoundName.trim() || busy}
                onClick={() => void handleCreateFromNotFound()}
              >
                Create Project
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => setOpenState({ kind: "idle" })}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* New project form */}
        {showNewForm && (
          <div style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}>
            <input
              className="input"
              placeholder="Project name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && form.name.trim() && form.savePath.trim()) {
                  void handleCreate();
                }
              }}
            />

            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <input
                className="input input--mono"
                placeholder="Save location"
                value={form.savePath}
                onChange={(e) => setForm((prev) => ({ ...prev, savePath: e.target.value }))}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void handleBrowseSavePath()}
              >
                Browse
              </button>
            </div>

            {/* Add existing content toggle */}
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                  userSelect: "none",
                  padding: "var(--space-1) 0",
                }}
                onClick={() => setForm((prev) => ({ ...prev, showImport: !prev.showImport }))}
              >
                <span style={{
                  transition: "transform var(--duration-fast) ease",
                  transform: form.showImport ? "rotate(90deg)" : "rotate(0deg)",
                  fontSize: "var(--text-xs)",
                }}>
                  &#9656;
                </span>
                Add existing content
              </div>
              {form.showImport && (
                <div style={{
                  paddingLeft: "var(--space-3)",
                  paddingTop: "var(--space-2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{
                        borderColor: form.importKind === "folder" ? "var(--accent)" : undefined,
                        color: form.importKind === "folder" ? "var(--accent)" : undefined,
                      }}
                      onClick={() => setForm((prev) => ({ ...prev, importKind: "folder", importPath: "" }))}
                    >
                      Folder
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{
                        borderColor: form.importKind === "zip" ? "var(--accent)" : undefined,
                        color: form.importKind === "zip" ? "var(--accent)" : undefined,
                      }}
                      onClick={() => setForm((prev) => ({ ...prev, importKind: "zip", importPath: "" }))}
                    >
                      Zip Archive
                    </button>
                  </div>
                  {form.importKind !== "none" && (
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <input
                        className="input input--mono"
                        placeholder={form.importKind === "folder" ? "/path/to/source-folder" : "/path/to/archive.zip"}
                        value={form.importPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, importPath: e.target.value }))}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => void handleBrowseImportPath()}
                      >
                        Browse
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                className="btn btn--primary"
                disabled={!form.name.trim() || !form.savePath.trim() || busy}
                onClick={() => void handleCreate()}
              >
                {busy ? "Creating..." : "Create"}
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => setShowNewForm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}>
            <span style={{
              fontSize: "var(--text-2xs)",
              fontWeight: "var(--weight-semibold)",
              letterSpacing: "var(--tracking-caps)",
              textTransform: "uppercase",
              color: "var(--text-ghost)",
              marginBottom: "var(--space-2)",
            }}>
              Recent Projects
            </span>
            <div style={{
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              maxHeight: 280,
              overflowY: "auto",
            }}>
              {recentProjects.map((project) => {
                const binding = getProjectBinding(project.id);
                return (
                  <div
                    key={project.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "var(--space-2) var(--space-3)",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-subtle)",
                      transition: "background var(--duration-instant) ease",
                    }}
                    onClick={() => handleRecentClick(project.id)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
                      <span style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: "var(--weight-medium)",
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {project.name}
                      </span>
                      <span style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-ghost)",
                        fontFamily: "var(--font-mono)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {binding ? binding.localPath : "No local folder"}
                      </span>
                    </div>
                    <span style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--text-ghost)",
                      whiteSpace: "nowrap",
                      marginLeft: "var(--space-3)",
                    }}>
                      {formatRelativeDate(project.updatedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
