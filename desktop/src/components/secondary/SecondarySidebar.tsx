import { useUI } from "../../contexts/UIContext";
import { ChatPanel } from "./ChatPanel";
import { InspectorPanel } from "./InspectorPanel";

const TABS = [
  { id: "chat" as const, label: "Chat" },
  { id: "inspector" as const, label: "Inspector" },
  { id: "voice" as const, label: "Voice" },
];

export function SecondarySidebar() {
  const { secondarySidebarOpen, secondaryTab, setSecondaryTab } = useUI();

  return (
    <div className={`secondary-sidebar${secondarySidebarOpen ? "" : " secondary-sidebar--collapsed"}`}>
      {secondarySidebarOpen && (
        <>
          <div className="secondary-sidebar__tabs">
            {TABS.map((t) => (
              <div
                key={t.id}
                className={`secondary-sidebar__tab${secondaryTab === t.id ? " secondary-sidebar__tab--active" : ""}`}
                onClick={() => setSecondaryTab(t.id)}
              >
                {t.label}
              </div>
            ))}
          </div>
          <div className="secondary-sidebar__content">
            {secondaryTab === "chat" && <ChatPanel />}
            {secondaryTab === "inspector" && <InspectorPanel />}
            {secondaryTab === "voice" && <VoicePlaceholder />}
          </div>
        </>
      )}
    </div>
  );
}

function VoicePlaceholder() {
  return (
    <div style={{ padding: "var(--space-4)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
      Voice workspace will be ported in Phase 4.
    </div>
  );
}
