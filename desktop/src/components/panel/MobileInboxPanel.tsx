import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listMobileInboxItems,
  listMobileReviewDecisions,
  type MobileInboxItem,
  type MobileReviewDecision,
} from "../../api";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { createHostedMobileSyncCoordinator, type HostedMobileSyncCoordinator } from "../../mobileSync/hostedCoordinator";
import { connectDesktopMobileSync } from "../../mobileSync/connectDesktop";
import { cloudConfiguration, desktopAccount } from "../../cloud/account";
import { CloudSignIn } from "../../cloud/CloudSignIn";
import { TrustedDevicesPanel } from "./TrustedDevicesPanel";
import { deviceReviewOperation, forgetCompanionRecoveryKeys } from "../../mobileSync/deviceReviewOperation";

// Retain in-memory connection/key state when this panel is unmounted or the
// author visits another book. Every RPC still verifies the enrolled account.
const connections = new Map<string, HostedMobileSyncCoordinator>();

function payloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export function MobileInboxPanel() {
  const { activeProjectId, projectRoot } = useWorkspace();
  return <ProjectMobileInbox key={`${activeProjectId}:${projectRoot}`} />;
}

function ProjectMobileInbox() {
  const { activeProjectId, projectFound, projectRoot, setError } = useWorkspace();
  const [inbox, setInbox] = useState<MobileInboxItem[]>([]);
  const [reviews, setReviews] = useState<MobileReviewDecision[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [unlockVersion, setUnlockVersion] = useState("1");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);
  const connectionScope = JSON.stringify([activeProjectId, projectRoot]);
  const [connected, setConnected] = useState<HostedMobileSyncCoordinator | null>(() => connections.get(connectionScope) ?? null);
  const active = useRef(true);
  const busy = useRef(false);
  const accountGeneration = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const initialCoordinator = useMemo(() => {
    return createHostedMobileSyncCoordinator({
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      publishableKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      projectId: projectFound ? activeProjectId : null,
      projectRoot: projectFound ? projectRoot : null,
    });
  }, [activeProjectId, projectFound, projectRoot]);
  const coordinator = connected ?? initialCoordinator;
  const currentCoordinator = useRef(coordinator);
  currentCoordinator.current = coordinator;
  const [, refreshSyncState] = useState(0);
  const syncState = coordinator.getState();

  useEffect(() => {
    setRecoveryInput("");
    setSyncMessage("");
  }, [coordinator]);

  const runSyncAction = useCallback(async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (busy.current || deviceBusy) return;
    busy.current = true;
    setSyncBusy(true);
    setSyncMessage("");
    const generation = accountGeneration.current;
    const isCurrent = () => active.current && accountGeneration.current === generation && currentCoordinator.current === coordinator;
    try {
      await action(isCurrent);
      if (isCurrent()) refreshSyncState((version) => version + 1);
    } catch (error) {
      if (isCurrent()) setError(
        `Mobile sync failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      if (accountGeneration.current === generation) {
        busy.current = false;
        if (active.current) setSyncBusy(false);
      }
    }
  }, [coordinator, deviceBusy, setError]);
  const connectedIdentity = connected?.getIdentity();
  const deviceScope = connectedIdentity ? JSON.stringify([projectRoot, activeProjectId, connectedIdentity.userId, connectedIdentity.deviceId]) : null;
  const changeConnection = (next: HostedMobileSyncCoordinator | null) => {
    if (next) connections.set(connectionScope, next); else connections.delete(connectionScope);
    setConnected(next);
    setDeviceBusy(false);
  };
  const controlsBusy = syncBusy || deviceBusy;
  const unresolvedDeviceChange = deviceScope ? deviceReviewOperation(deviceScope).getSnapshot().requiresRefresh : false;
  const syncBlocked = controlsBusy || unresolvedDeviceChange;
  const coordinatorGeneration = accountGeneration.current;

  const refresh = useCallback(async () => {
    if (!projectFound) return;
    setLoading(true);
    try {
      const [nextInbox, nextReviews] = await Promise.all([
        listMobileInboxItems(projectRoot),
        listMobileReviewDecisions(projectRoot),
      ]);
      if (!active.current) return;
      setInbox(nextInbox);
      setReviews(nextReviews);
    } catch (error) {
      if (active.current) setError(
        `Failed to load mobile inbox: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      if (active.current) setLoading(false);
    }
  }, [projectFound, projectRoot, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!projectFound) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)" }}>
        Open a project to review mobile captures.
      </div>
    );
  }

  return (
    <section aria-label="Mobile inbox" style={{ padding: "var(--space-4)", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: "var(--text-base)" }}>
            Mobile Inbox
          </h2>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 3 }}>
            Imported captures and review intent. Decisions are finalized elsewhere on desktop.
          </div>
        </div>
        <button className="btn btn--sm" disabled={loading} onClick={() => void refresh()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <section aria-label="Hosted mobile sync" style={syncCardStyle}>
        <strong style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
          Hosted encrypted sync
        </strong>
        <div role="status" style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
          {syncState.message}
        </div>

        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
          Connect this computer to your companion account, then publish an encrypted copy for your phone.
          Captures return here for review; mobile does not edit the manuscript.
        </p>
        <div style={syncControlsStyle}>
          <button className="btn btn--sm" disabled={controlsBusy || !cloudConfiguration()}
            onClick={() => void runSyncAction(async (isCurrent) => {
              const account = await desktopAccount();
              if (!await account.session()) {
                if (isCurrent()) setShowSignIn(true);
                return;
              }
              if (!activeProjectId) throw new Error("Open a hosted project before connecting.");
              const next = await connectDesktopMobileSync(activeProjectId, projectRoot);
              if (isCurrent()) { changeConnection(next); setShowSignIn(false); }
            })}>
            {controlsBusy ? "Working…" : connected ? "Reconnect this desktop" : "Connect this desktop"}
          </button>
          <button className="btn btn--sm" disabled={controlsBusy || !cloudConfiguration()}
            onClick={() => setShowSignIn((value) => !value)}>Companion account</button>
          {connected && <button className="btn btn--sm" disabled={controlsBusy}
            onClick={() => void runSyncAction(async (isCurrent) => {
              await (await desktopAccount()).signOut();
              connections.clear(); forgetCompanionRecoveryKeys();
              if (isCurrent()) { changeConnection(null); setRecoveryInput(""); }
            })}>Sign out of companion</button>}
        </div>
        {showSignIn && <CloudSignIn onSignedIn={() => {
          if (active.current) {
            accountGeneration.current++;
            busy.current = false; setSyncBusy(false); setDeviceBusy(false);
            setRecoveryInput("");
            connections.clear(); forgetCompanionRecoveryKeys(); changeConnection(null);
            setShowSignIn(false);
            setSyncMessage("Signed in. Select Connect this desktop to set up encrypted sync for this book.");
          }
        }} />}

        {connectedIdentity && activeProjectId && <TrustedDevicesPanel
          key={deviceScope!} coordinator={coordinator} projectId={activeProjectId} projectRoot={projectRoot}
          disabled={syncBusy} onBusyChange={value => { if (active.current && accountGeneration.current === coordinatorGeneration && currentCoordinator.current === coordinator) setDeviceBusy(value); }}
          onChanged={() => { if (active.current && accountGeneration.current === coordinatorGeneration && currentCoordinator.current === coordinator) refreshSyncState(version => version + 1); }}
        />}

        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
          Recovery input must match this book's verified current key. It cannot restore a missing device key envelope; reconnect or review a new book key rotation instead.
        </p>
        <div style={syncControlsStyle}>
          <label style={syncLabelStyle}>
            Recovery key version
            <input
              className="input input--mono"
              inputMode="numeric"
              value={unlockVersion}
              onChange={(event) => setUnlockVersion(event.target.value)}
            />
          </label>
          <label style={{ ...syncLabelStyle, flex: 2 }}>
            Recovery key
            <input
              className="input input--mono"
              type="password"
              autoComplete="off"
              value={recoveryInput}
              onChange={(event) => setRecoveryInput(event.target.value)}
            />
          </label>
          <button
            className="btn btn--sm"
            disabled={syncBlocked || syncState.status === "setup_required"}
            onClick={() => void runSyncAction(async (isCurrent) => {
              await coordinator.unlockRecoveryKey(Number(unlockVersion), recoveryInput);
              if (isCurrent()) { setRecoveryInput(""); setSyncMessage(`Unlocked key version ${unlockVersion} in memory.`); }
            })}
          >
            Unlock recovery key
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn--sm"
            disabled={syncBlocked || syncState.status !== "ready"}
            onClick={() => void runSyncAction(async (isCurrent) => {
              await coordinator.publishSnapshot();
              if (deviceScope) deviceReviewOperation(deviceScope).published();
              if (isCurrent()) setSyncMessage("Encrypted snapshot published.");
            })}
          >
            Publish snapshot
          </button>
          <button
            className="btn btn--sm"
            disabled={syncBlocked || syncState.status !== "ready"}
            onClick={() => void runSyncAction(async (isCurrent) => {
              const report = await coordinator.importOutbox();
              if (!isCurrent()) return;
              setSyncMessage(
                `Imported ${report.imported.length} mobile items; ${report.failures.length} need attention.`
              );
              await refresh();
            })}
          >
            Import outbox
          </button>
        </div>

        {syncMessage && (
          <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
            {syncMessage}
          </div>
        )}
      </section>

      <h3 style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", margin: "16px 0 8px" }}>
        Captures · {inbox.length}
      </h3>
      {inbox.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
          No mobile captures imported yet.
        </div>
      ) : inbox.map((item) => {
        const content = payloadText(item.payload, "content");
        return (
          <article key={item.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
                {item.title || (item.kind === "thread_turn" ? "Mobile thread turn" : "Mobile note")}
              </strong>
              <span className="badge">{item.kind === "thread_turn" ? "Turn" : "Note"}</span>
            </div>
            {content && (
              <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
                {content}
              </p>
            )}
            <small style={metadataStyle}>{item.device_id} · {item.operation_id}</small>
          </article>
        );
      })}

      <h3 style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", margin: "16px 0 8px" }}>
        Review intent · {reviews.length}
      </h3>
      {reviews.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
          No mobile review decisions awaiting desktop review.
        </div>
      ) : reviews.map((item) => {
        const decision = payloadText(item.payload, "decision") || "pending";
        return (
          <article key={item.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
                Review decision · {decision}
              </strong>
              <span className={`badge${item.stale ? " badge--warning" : ""}`}>
                {item.stale ? "Conflict" : "Pending"}
              </span>
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: 8 }}>
              {payloadText(item.payload, "target_kind") || "review item"} · {payloadText(item.payload, "target_id") || "target pending"}
            </div>
            <small style={metadataStyle}>{item.device_id} · {item.operation_id}</small>
          </article>
        );
      })}
    </section>
  );
}

const cardStyle = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-surface)",
  padding: "var(--space-3)",
  marginBottom: "var(--space-2)",
} as const;

const metadataStyle = {
  display: "block",
  color: "var(--text-tertiary)",
  fontSize: "var(--text-xs)",
  marginTop: 8,
} as const;

const syncCardStyle = {
  display: "grid",
  gap: 10,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-surface)",
  padding: "var(--space-3)",
  marginTop: "var(--space-4)",
} as const;

const syncControlsStyle = {
  display: "flex",
  alignItems: "end",
  gap: 8,
  flexWrap: "wrap",
} as const;

const syncLabelStyle = {
  display: "grid",
  gap: 4,
  color: "var(--text-tertiary)",
  fontSize: "var(--text-xs)",
  flex: 1,
  minWidth: 130,
} as const;
