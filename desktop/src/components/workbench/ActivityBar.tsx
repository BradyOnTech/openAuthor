import type { JSX } from "react";
import { useUI, type ActivityView } from "../../contexts/UIContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { countProposals, countContinuityIssues } from "../../state";
import { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";

const VIEWS: { id: ActivityView; label: string; shortcut: string }[] = [
  { id: "manuscript", label: "Manuscript", shortcut: "Cmd+Shift+E" },
  { id: "plan", label: "Plan", shortcut: "Cmd+Shift+P" },
  { id: "codex", label: "Story Memory", shortcut: "Cmd+Shift+X" },
  { id: "storylines", label: "Storylines", shortcut: "Cmd+Shift+L" },
  { id: "search", label: "Search", shortcut: "Cmd+Shift+F" },
  { id: "proposals", label: "Changes", shortcut: "Cmd+Shift+R" },
  { id: "checks", label: "Checks", shortcut: "Cmd+Shift+C" },
];

function ManuscriptIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h10a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M7 6h6M7 9h6M7 12h4" />
    </svg>
  );
}

function CodexIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h11a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V3z" />
      <path d="M4 7h14M8 3v4" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="5" rx="1" />
      <rect x="11" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="12" width="6" height="5" rx="1" />
      <path d="M12 14.5h5M14.5 12v5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.5 12.5L17 17" />
    </svg>
  );
}

function StorylineIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3v5c0 2 2 3 4 3h8" /><path d="M8 11c-2 0-4 1-4 3v3" /><circle cx="4" cy="3" r="1.5" /><circle cx="16" cy="11" r="1.5" /><circle cx="4" cy="17" r="1.5" />
    </svg>
  );
}

function ProposalIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l2 4 4.5.5-3.25 3.25.75 4.75L10 12.5 5.5 14.5l.75-4.75L3 6.5 7.5 6z" />
    </svg>
  );
}

function ChecksIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2a8 8 0 100 16 8 8 0 000-16z" />
      <path d="M7 10l2 2 4-4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.22 4.22l1.77 1.77M13.01 13.01l1.77 1.77M4.22 15.78l1.77-1.77M13.01 6.99l1.77-1.77" />
    </svg>
  );
}

function AssistantIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l1.2 4.1L15 8l-3.8 1.9L10 14l-1.2-4.1L5 8l3.8-1.9L10 2z" />
      <path d="M15.5 13l.7 2.1 1.8.9-1.8.9-.7 2.1-.7-2.1L13 16l1.8-.9.7-2.1z" />
    </svg>
  );
}

const ICONS: Record<ActivityView | "settings", () => JSX.Element> = {
  manuscript: ManuscriptIcon,
  plan: PlanIcon,
  codex: CodexIcon,
  storylines: StorylineIcon,
  search: SearchIcon,
  proposals: ProposalIcon,
  checks: ChecksIcon,
  settings: SettingsIcon,
};

export function ActivityBar() {
  const { activeView, sidebarOpen, secondarySidebarOpen, secondaryTab, setSecondarySidebarOpen, setSecondaryTab } = useUI();
  const { proposals, continuityIssues } = useWorkspace();
  const navigateTo = useWorkspaceNavigation();

  const pendingCount = countProposals(proposals).pending;
  const errorCount = countContinuityIssues(continuityIssues).error;

  function handleClick(view: ActivityView) {
    void navigateTo(view);
  }

  return (
    <div className="activity-bar">
      {VIEWS.map((v) => {
        const Icon = ICONS[v.id];
        const isActive = activeView === v.id && sidebarOpen;
        const badge =
          v.id === "proposals" && pendingCount > 0
            ? pendingCount
            : v.id === "checks" && errorCount > 0
              ? errorCount
              : null;

        return (
          <button
            type="button"
            key={v.id}
            className={`activity-bar__item${isActive ? " activity-bar__item--active" : ""}`}
            onClick={() => handleClick(v.id)}
            title={`${v.label} (${v.shortcut})`}
            aria-label={`${v.label} (${v.shortcut})`}
            aria-pressed={isActive}
          >
            <Icon />
            {badge !== null && <span className="activity-bar__badge">{badge}</span>}
          </button>
        );
      })}

      <div className="activity-bar__spacer" />

      <button
        type="button"
        className={`activity-bar__item${secondarySidebarOpen && secondaryTab === "chat" ? " activity-bar__item--active" : ""}`}
        onClick={() => {
          const isOpen = secondarySidebarOpen && secondaryTab === "chat";
          setSecondaryTab("chat");
          setSecondarySidebarOpen(!isOpen);
        }}
        title="Assistant (Cmd+L)"
        aria-label="Assistant (Cmd+L)"
        aria-pressed={secondarySidebarOpen && secondaryTab === "chat"}
      >
        <AssistantIcon />
      </button>

      <button
        type="button"
        className={`activity-bar__item${activeView === "settings" && sidebarOpen ? " activity-bar__item--active" : ""}`}
        onClick={() => handleClick("settings")}
        title="Settings (Cmd+,)"
        aria-label="Settings (Cmd+,)"
        aria-pressed={activeView === "settings" && sidebarOpen}
      >
        <SettingsIcon />
      </button>
    </div>
  );
}
