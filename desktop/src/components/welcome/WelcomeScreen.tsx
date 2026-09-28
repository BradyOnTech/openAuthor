import { useCallback, useMemo, useState } from "react";
import { BackupRestore } from "../BackupControls";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import {
  getProjectStatus,
  pickFolder,
  pickManuscriptFile,
  previewManuscriptImport,
  type ManuscriptImportPreview,
} from "../../api";
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
  importKind: "none" | "manuscript_file" | "manuscript_folder";
  importPath: string;
  importStrategy: "auto" | "files" | "headings" | "single";
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
  const [showRecovery, setShowRecovery] = useState(false);
  const [form, setForm] = useState<NewProjectForm>({
    name: "",
    savePath: "",
    importKind: "none",
    importPath: "",
    importStrategy: "auto",
    showImport: false,
  });
  const [importPreview, setImportPreview] = useState<ManuscriptImportPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [openState, setOpenState] = useState<OpenProjectState>({ kind: "idle" });
  const [notFoundName, setNotFoundName] = useState("");
  const [notFoundPath, setNotFoundPath] = useState("");

  const recentProjects = useMemo(() => {
    const seenLocations = new Set<string>();
    return projects
      .filter((p) => p.status === "active")
      .filter((project) => {
        const binding = getProjectBinding(project.id);
        if (isDesktopRuntime() && !binding) return false;
        const key = binding?.localPath.trim().toLowerCase() || project.id;
        if (seenLocations.has(key)) return false;
        seenLocations.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [projects]);

  const handleNewProject = useCallback(() => {
    setShowNewForm(true);
    setOpenState({ kind: "idle" });
  }, []);

  const handleCreate = useCallback(async () => {
    const importSource = form.importKind !== "none" && form.importPath.trim()
      ? { kind: form.importKind, path: form.importPath.trim(), strategy: form.importStrategy }
      : undefined;
    const ok = await createAndOpenProject({
      name: form.name,
      savePath: form.savePath,
      importSource,
    });
    if (ok) {
      setShowNewForm(false);
      setForm({ name: "", savePath: "", importKind: "none", importPath: "", importStrategy: "auto", showImport: false });
      setImportPreview(null);
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
    if (form.importKind === "manuscript_folder") {
      const selected = await browseFolder(form.importPath || undefined);
      if (selected) {
        setForm((prev) => ({ ...prev, importPath: selected }));
        setImportPreview(null);
      }
    } else {
      const selected = await pickManuscriptFile(form.importPath || undefined);
      if (selected) {
        setForm((prev) => ({ ...prev, importPath: selected }));
        setImportPreview(null);
      }
    }
  }, [form.importKind, form.importPath]);

  const handlePreviewImport = useCallback(async () => {
    if (!form.importPath.trim()) return;
    setPreviewBusy(true);
    try {
      const preview = await previewManuscriptImport(form.importPath.trim(), form.importStrategy);
      setImportPreview(preview);
      setError("");
    } catch (e) {
      setImportPreview(null);
      setError(`Import preview failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreviewBusy(false);
    }
  }, [form.importPath, form.importStrategy, setError]);

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

        <button className="btn btn--ghost" style={{ minHeight: 40 }} aria-expanded={showRecovery} onClick={() => setShowRecovery(value => !value)} disabled={busy}>Restore backup</button>
        {showRecovery && <BackupRestore onRestored={attachProjectRoot} setError={setError} />}

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
            <div>
              <h2 style={{ margin: 0, fontFamily: "var(--font-prose)", fontSize: "var(--text-xl)", color: "var(--text-primary)" }}>Create a novel</h2>
              <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Start blank or bring in an existing manuscript. Nothing here changes the source you import.</p>
            </div>
            <label style={{ display: "grid", gap: 5, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
              Novel title
            <input
              className="input"
              placeholder="e.g. The Lantern Coast"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && form.name.trim() && form.savePath.trim()) {
                  void handleCreate();
                }
              }}
            />
            </label>

            <div style={{ display: "grid", gap: 5, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
              <label htmlFor="new-project-folder">Project folder</label>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <input
                  id="new-project-folder"
                  className="input input--mono"
                  placeholder="Choose a folder for this novel"
                  value={form.savePath}
                  onChange={(e) => setForm((prev) => ({ ...prev, savePath: e.target.value }))}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => void handleBrowseSavePath()}
                >
                  Browse…
                </button>
              </div>
              <span style={{ color: "var(--text-ghost)" }}>Scenes, Story Memory, and revision history stay in this local folder.</span>
            </div>

            {/* Add existing content toggle */}
            <div>
              <button
                type="button"
                aria-expanded={form.showImport}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                  userSelect: "none",
                  padding: "var(--space-1) 0",
                  border: 0,
                  background: "transparent",
                  font: "inherit",
                  width: "100%",
                  textAlign: "left",
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
              </button>
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
                        borderColor: form.importKind === "manuscript_file" ? "var(--accent)" : undefined,
                        color: form.importKind === "manuscript_file" ? "var(--accent)" : undefined,
                      }}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, importKind: "manuscript_file", importPath: "" }));
                        setImportPreview(null);
                      }}
                    >
                      Manuscript File
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{
                        borderColor: form.importKind === "manuscript_folder" ? "var(--accent)" : undefined,
                        color: form.importKind === "manuscript_folder" ? "var(--accent)" : undefined,
                      }}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, importKind: "manuscript_folder", importPath: "", importStrategy: "files" }));
                        setImportPreview(null);
                      }}
                    >
                      Folder / Scrivener
                    </button>
                  </div>
                  {form.importKind !== "none" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      <div style={{ display: "flex", gap: "var(--space-2)" }}>
                        <input
                          className="input input--mono"
                          placeholder={form.importKind === "manuscript_folder" ? "/path/to/scenes-or-Novel.scriv" : "/path/to/novel.docx-or-project.scrivx"}
                          value={form.importPath}
                          onChange={(e) => {
                            setForm((prev) => ({ ...prev, importPath: e.target.value }));
                            setImportPreview(null);
                          }}
                          style={{ flex: 1 }}
                        />
                        <button className="btn btn--ghost btn--sm" onClick={() => void handleBrowseImportPath()}>
                          Browse
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: "var(--space-2)" }}>
                        <select
                          className="select"
                          value={form.importStrategy}
                          onChange={(e) => {
                            setForm((prev) => ({ ...prev, importStrategy: e.target.value as NewProjectForm["importStrategy"] }));
                            setImportPreview(null);
                          }}
                          aria-label="Import structure"
                        >
                          <option value="auto">Detect structure</option>
                          <option value="headings">Split at headings</option>
                          <option value="files">One scene per file</option>
                          <option value="single">Keep as one scene</option>
                        </select>
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={!form.importPath.trim() || previewBusy}
                          onClick={() => void handlePreviewImport()}
                        >
                          {previewBusy ? "Previewing..." : "Preview Structure"}
                        </button>
                      </div>
                      {importPreview && (
                        <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)", maxHeight: 150, overflowY: "auto" }}>
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>
                            {importPreview.scene_count} scenes · {importPreview.word_count.toLocaleString()} words
                          </div>
                          {importPreview.scenes.map((scene) => (
                            <div key={`${scene.position}-${scene.title}`} style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                              {scene.position}. {scene.title} ({scene.word_count.toLocaleString()} words)
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                className="btn btn--primary"
                disabled={
                  !form.name.trim() || !form.savePath.trim() || busy ||
                  (form.importKind !== "none" && !importPreview)
                }
                onClick={() => void handleCreate()}
              >
                {busy ? "Creating novel…" : "Create novel"}
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
                  <button
                    type="button"
                    key={project.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "var(--space-2) var(--space-3)",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border-subtle)",
                      transition: "background var(--duration-instant) ease",
                      width: "100%",
                      border: 0,
                      background: "transparent",
                      font: "inherit",
                      textAlign: "left",
                    }}
                    onClick={() => handleRecentClick(project.id)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    aria-label={`Open ${project.name}`}
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
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
