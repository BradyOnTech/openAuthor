import { useEffect, useRef, useState } from "react";
import { cloudConfiguration, desktopAccount } from "../../cloud/account";
import { deploymentScope, nativeSecrets } from "../../cloud/secretStore";
import { createAccountDeletionClient, type AccountDeletionChoices, type AccountDeletionReview, type AccountDeletionStatus } from "../../cloud/accountDeletion";

type Identity = { userId: string; deviceId: string } | null;
export function AccountDeletionPanel({ identity, disabled, onRequested, onRequestPending }: { identity: Identity; disabled: boolean; onRequested(): void; onRequestPending?(): void }) {
  const [review, setReview] = useState<AccountDeletionReview | null>(null);
  const [choices, setChoices] = useState<AccountDeletionChoices | null>(null);
  const [progress, setProgress] = useState<AccountDeletionStatus | null>(null);
  const [accountId, setAccountId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false), serial = useRef(0), running = useRef(false);
  const scope = JSON.stringify([identity?.userId, identity?.deviceId]);
  const activeScope = useRef(scope); activeScope.current = scope;
  const client = useRef<{ key: string; value: ReturnType<typeof createAccountDeletionClient> } | null>(null);
  const unsubscribe = useRef<(() => void) | undefined>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; unsubscribe.current?.(); }; }, []);
  function clear() {
    serial.current++; running.current = false; client.current = null;
    setReview(null); setChoices(null); setProgress(null); setAccountId(""); setAcknowledged(false); setConfirmed(false); setBusy(false); setUncertain(false); setError(""); setNotice("");
  }
  useEffect(clear, [scope]);
  async function load(mode: "status" | "review") {
    if (disabled || running.current) return;
    const operation = ++serial.current;
    const current = () => mounted.current && activeScope.current === scope && operation === serial.current;
    running.current = true; setBusy(true); setError(""); setNotice(""); setConfirmed(false); setAcknowledged(false);
    try {
      const account = await desktopAccount();
      const session = await account.session(identity ? { userId: identity.userId } : undefined);
      if (!current()) return;
      if (!session || identity && session.userId !== identity.userId) throw new Error("Sign in to the companion account you intend to review.");
      const key = JSON.stringify([session.userId, identity?.deviceId]);
      if (client.current?.key !== key) client.current = { key, value: createAccountDeletionClient(account, { userId: session.userId, deviceId: identity?.deviceId }) };
      unsubscribe.current?.(); unsubscribe.current = account.onIdentityChange?.(() => { if (mounted.current) clear(); });
      let value = client.current.value;
      const owned = await value.current();
      if (!current()) return;
      setAccountId(session.userId); setProgress(owned);
      if (owned) { setReview(null); setChoices(null); setUncertain(false); onRequested(); return; }
      if (uncertain) { setNotice("No completed request is confirmed yet. Keep this pending review and check status again; no request was retried."); return; }
      if (mode === "status") { setNotice("No account deletion request was found."); return; }
      if (!identity) {
        const config = cloudConfiguration();
        if (!config) throw new Error("Companion hosting has not been configured for this build.");
        // Device registration can refresh its JWT binding. Fence it through
        // enrollment's verified session before observing the new identity.
        unsubscribe.current?.(); unsubscribe.current = undefined;
        setReview(null); setChoices(null);
        const { enrollDesktopAccount } = await import("../../cloud/desktopEnrollment");
        const enrolled = await enrollDesktopAccount({ scope: await deploymentScope(config.url), userId: session.userId, account, secrets: nativeSecrets });
        if (!current()) return;
        client.current = { key: JSON.stringify([enrolled.userId, enrolled.deviceId]), value: createAccountDeletionClient(account, enrolled) };
        value = client.current.value;
        unsubscribe.current = account.onIdentityChange?.(() => { if (mounted.current) clear(); });
      }
      const next = await value.preflight();
      if (!current()) return;
      const deletedWorkspaces = new Set(next.inventory.workspaces.filter(row => row.role === "owner" && row.other_members === 0).map(row => row.workspace_id));
      setReview(next); setChoices({
        workspaces: next.inventory.workspaces.map(row => ({ workspace_id: row.workspace_id, action: deletedWorkspaces.has(row.workspace_id) ? "delete" : "leave" })),
        projects: next.inventory.projects.map(row => ({ project_id: row.project_id, action: deletedWorkspaces.has(row.workspace_id) || row.project_deletion_job !== null ? "delete" : "retain", outbox: "preserve" })),
      });
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "Account deletion review is unavailable."); }
    finally { if (current()) { running.current = false; setBusy(false); } }
  }
  const blockedOwnership = review?.inventory.workspaces.some(row => row.role === "owner" && row.other_members > 0 && row.other_owners === 0) ?? false;
  const retained = choices?.projects.some(row => row.action === "retain") ?? false;
  async function begin() {
    if (disabled || running.current || uncertain || !review || !choices || !confirmed || retained && !acknowledged || blockedOwnership || !client.current) return;
    const operation = ++serial.current;
    const current = () => mounted.current && activeScope.current === scope && operation === serial.current;
    const submitted = { review, choices: structuredClone(choices), acknowledged };
    const value = client.current.value;
    running.current = true; setBusy(true); setError(""); setConfirmed(false); setUncertain(true);
    onRequestPending?.();
    try {
      const result = await value.begin(submitted.review, submitted.choices, submitted.acknowledged);
      if (!current()) return;
      setProgress(result); setReview(null); setChoices(null); setUncertain(false); onRequested();
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "The request outcome is unconfirmed."); }
    finally { if (current()) { running.current = false; setBusy(false); } }
  }
  return <details style={{ marginTop: 12 }}>
    <summary>Hosted account deletion</summary>
    <section aria-label="Hosted account deletion review" style={{ display: "grid", gap: 10, marginTop: 10 }}>
      <p style={small}>Review every hosted workspace and book before requesting deletion. Local manuscript folders stay on this computer. Shared contributions can remain with other members; downloaded or imported copies cannot be recalled here.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="btn btn--sm" disabled={disabled || busy || uncertain} onClick={() => void load("review")}>Review hosted account deletion</button>
        <button className="btn btn--sm" disabled={disabled || busy} onClick={() => void load("status")}>Check account deletion status</button>
      </div>
      {busy && <p role="status">Checking the reviewed account…</p>}
      {accountId && <p style={small}>Account <code>{accountId}</code></p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {uncertain && <p role="status">The request may have reached the server. Check account status before continuing. No automatic retry was made.</p>}
      {review && choices && <>
        <h3 style={{ margin: 0, fontSize: "var(--text-sm)" }}>Exact hosted inventory</h3>
        <ul style={{ paddingLeft: 20, margin: 0 }}>{review.inventory.workspaces.map(row => <li key={row.workspace_id}>
          {row.name}: {choices.workspaces.find(choice => choice.workspace_id === row.workspace_id)?.action === "delete" ? "Delete workspace and its hosted books" : "Leave workspace; other members keep it"}.
          {row.role === "owner" && row.other_members > 0 && row.other_owners === 0 && " Assign another owner before requesting deletion."}
        </li>)}</ul>
        {review.inventory.projects.map(row => {
          const choice = choices.projects.find(choice => choice.project_id === row.project_id)!;
          return <div key={row.project_id} style={{ overflowWrap: "anywhere" }}>
            <strong>{row.name ?? "Previously accessible book"}</strong><br /><code>{row.project_id}</code>
            {row.project_deletion_job && <p style={small}>Previously approved deletion: {row.project_deletion_job.phase.replace(/_/g, " ")}</p>}
            <p style={small}>{choice.action === "delete" ? "Delete hosted encrypted data through verified cleanup." : "Retain shared book history; remove this account’s access and identifying attribution."}{choice.action === "retain" && row.needs_rotation && " Remaining members must rotate the book key before account finalization."}</p>
            {choice.action === "retain" && row.own_outbox_ids.length > 0 && <label style={small}>My {row.own_outbox_ids.length} pending captures in this book
              <select className="select" disabled={busy || uncertain} value={choice.outbox} onChange={event => {
                const outbox = event.target.value as "preserve" | "remove";
                setChoices({ ...choices, projects: choices.projects.map(item => item.project_id === row.project_id ? { ...item, outbox } : item) }); setConfirmed(false); setAcknowledged(false);
              }}><option value="preserve">Keep in shared contribution history</option><option value="remove">Remove hosted pending captures</option></select>
            </label>}
          </div>;
        })}
        {review.inventory.existing_project_jobs.filter(row => !review.inventory.projects.some(project => project.project_id === row.project_id)).map(row => <div key={row.job_id} style={{ overflowWrap: "anywhere" }}>
          <strong>Previously approved book deletion</strong><br /><code>{row.project_id}</code>
          <p style={small}>Keep this deletion request linked to account cleanup: {row.phase.replace(/_/g, " ")}. Its removed project metadata is not recreated.</p>
        </div>)}
        <p style={small}>Revoke all {review.inventory.devices.length} account devices. Historical nonsecret device identifiers may remain only where shared encrypted history requires them; account labels, sessions and device keys are removed before Auth finalization.</p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>{review.inventory.devices.map(row => <li key={row.device_id} style={{ overflowWrap: "anywhere" }}>
          <span>{row.device_label || "Unnamed device"} · {row.platform}</span><br /><code>{row.device_id}</code>
        </li>)}</ul>
        {retained && <label style={small}><input type="checkbox" checked={acknowledged} disabled={busy || uncertain} onChange={event => { setAcknowledged(event.target.checked); setConfirmed(false); }} /> I reviewed the retained shared history and my pending-capture choices.</label>}
        <label style={small}><input type="checkbox" checked={confirmed} disabled={busy || uncertain || blockedOwnership} onChange={event => setConfirmed(event.target.checked)} /> I intend to permanently delete this hosted account and every item marked for deletion.</label>
        <button className="btn btn--sm" disabled={disabled || busy || uncertain || blockedOwnership || !confirmed || retained && !acknowledged} onClick={() => void begin()}>Request reviewed account deletion</button>
        <p style={small}>The request freezes hosted access and cannot be cancelled. Cleanup, shared-key rotation and independent verification must finish before the Auth account is removed.</p>
      </>}
      {progress && <div role="region" aria-label="Account deletion progress">
        <p>Request <code>{progress.job_id}</code>: {progress.phase.replace(/_/g, " ")}</p>
        <ul>{progress.projects.map(row => <li key={row.project_id}>{row.name ?? row.project_id}: {row.phase.replace(/_/g, " ")}{row.blockers.length > 0 && ` — ${row.blockers.join(", ")}`}</li>)}</ul>
        {progress.blockers.length > 0 && <p role="status">Required before finalization: {progress.blockers.join(", ")}</p>}
        <p style={small}>This status remains available while the initiating device is revoked. A pending phase does not certify backend deletion or final provider teardown.</p>
      </div>}
    </section>
  </details>;
}
const small = { margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-xs)", overflowWrap: "anywhere" } as const;
