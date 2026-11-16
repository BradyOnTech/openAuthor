import { useWorkspace } from "../contexts/WorkspaceContext";

/** The open book's name as the author knows it, or "" when none is open. */
export function useProjectName(): string {
  const { activeProjectId, projects, projectRoot } = useWorkspace();
  return projects.find(project => project.id === activeProjectId)?.name
    ?? (projectRoot ? projectRoot.split("/").pop() || "Project" : "");
}
