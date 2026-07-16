import { useUI } from "../../contexts/UIContext";
import { ChatPanel } from "./ChatPanel";
import { InspectorPanel } from "./InspectorPanel";

const TABS = [
  { id: "chat" as const, label: "Chat" },
  { id: "inspector" as const, label: "Inspector" },
];

export function SecondarySidebar() {
  const { secondarySidebarOpen, secondaryTab, setSecondarySidebarOpen, setSecondaryTab } = useUI();

  return (
    <div className={`secondary-sidebar${secondarySidebarOpen ? "" : " secondary-sidebar--collapsed"}`}>
      {secondarySidebarOpen && (
        <>
          <div className="secondary-sidebar__tabs">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`secondary-sidebar__tab${secondaryTab === t.id ? " secondary-sidebar__tab--active" : ""}`}
                onClick={() => setSecondaryTab(t.id)}
                aria-pressed={secondaryTab === t.id}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className="secondary-sidebar__close"
              onClick={() => setSecondarySidebarOpen(false)}
              aria-label="Close side panel"
              title="Close side panel"
            >
              {"\u00d7"}
            </button>
          </div>
          <div className="secondary-sidebar__content">
            {secondaryTab === "chat" && <ChatPanel />}
            {secondaryTab === "inspector" && <InspectorPanel />}
          </div>
        </>
      )}
    </div>
  );
}
