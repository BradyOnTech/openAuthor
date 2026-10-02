import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { HostedMobileSyncCoordinator } from "../../mobileSync/hostedCoordinator";
import type { MobileProjectDevice } from "../../mobileSync/projectKeyProvisioning";
import { deviceReviewOperation } from "../../mobileSync/deviceReviewOperation";
import { useRecoverableDraft } from "../../recoverableDraft";

type Draft = { previousVersion: string; reason: string; targetDeviceId: string; reviewIntent?: true };
function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Draft;
  return typeof draft.previousVersion === "string" && typeof draft.reason === "string" && typeof draft.targetDeviceId === "string"
    && (draft.reviewIntent === undefined || draft.reviewIntent === true);
}
const recipientKeys = (devices: MobileProjectDevice[]) => devices
  .filter(device => device.projectEnrolledAt !== null && device.projectRevokedAt === null)
  .map(device => ({ deviceId: device.deviceId, keyId: device.keyId }));

export function TrustedDevicesPanel({ coordinator, projectId, projectRoot, disabled, onBusyChange, onChanged }: {
  coordinator: HostedMobileSyncCoordinator;
  projectId: string;
  projectRoot: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => void;
}) {
  const identity = coordinator.getIdentity();
  const scope = JSON.stringify([projectRoot, projectId, identity?.userId, identity?.deviceId]);
  const operation = useMemo(() => deviceReviewOperation(scope), [scope]);
  const outcome = useSyncExternalStore(operation.subscribe, operation.getSnapshot);
  const initialVersion = String(coordinator.getState().latestKeyVersion ?? coordinator.getState().activeKeyVersion ?? 0);
  const recovery = useRecoverableDraft(`openauthor.companionDeviceReview.v1:${scope}`, {
    previousVersion: initialVersion, reason: "lost-device", targetDeviceId: "",
  }, validDraft);
  const draft = recovery.value;
  const [devices, setDevices] = useState<MobileProjectDevice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirmedDevice, setConfirmedDevice] = useState(false);
  const [rotationReview, setRotationReview] = useState<{ previousVersion: number; recipients: ReturnType<typeof recipientKeys>; reason: string } | null>(null);
  const [confirmedRotation, setConfirmedRotation] = useState(false);
  const mounted = useRef(false);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const loadSerial = useRef(0);
  const previousBusy = useRef(outcome.busy);
  const callbacks = useRef({ onBusyChange, onChanged });
  callbacks.current = { onBusyChange, onChanged };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadSerial.current++; }; }, [scope]);
  const isCurrent = () => mounted.current && activeScope.current === scope;
  useEffect(() => { callbacks.current.onBusyChange(outcome.busy); }, [outcome.busy]);
  useEffect(() => { setRotationReview(null); setConfirmedRotation(false); setConfirmedDevice(false); }, [draft.previousVersion, draft.reason, draft.targetDeviceId]);

  async function refresh(acknowledgeOutcome = false) {
    const serial = ++loadSerial.current;
    setLoading(true); setLoadError(""); setRotationReview(null); setConfirmedRotation(false); setConfirmedDevice(false);
    try {
      const next = await coordinator.listDevices();
      if (!isCurrent() || serial !== loadSerial.current) return;
      setDevices(next);
      if (acknowledgeOutcome) operation.refreshed();
      callbacks.current.onChanged();
    } catch (reason) {
      if (isCurrent() && serial === loadSerial.current) { setDevices(null); setLoadError(reason instanceof Error ? reason.message : String(reason)); callbacks.current.onChanged(); }
    } finally { if (isCurrent() && serial === loadSerial.current) setLoading(false); }
  }
  useEffect(() => { if (identity) void refresh(); }, [coordinator]);
  useEffect(() => {
    // A submitted action can finish in an earlier, unmounted view. The reopened
    // view observes the shared outcome and refreshes its own list, never the
    // other book's state. Failed outcomes still need explicit acknowledgement.
    if (previousBusy.current && !outcome.busy) void refresh();
    previousBusy.current = outcome.busy;
  }, [outcome.busy]);
  const blocked = disabled || outcome.busy || loading;
  const writeBlocked = blocked || outcome.requiresRefresh;
  const target = devices?.find(device => device.deviceId === draft.targetDeviceId);
  const activeTarget = target && target.projectEnrolledAt !== null && target.projectRevokedAt === null && target.deviceId !== identity?.deviceId;
  const updateDraft = (changes: Partial<Draft>) => recovery.session.edit({ ...recovery.session.getSnapshot().value, ...changes });

  async function revoke() {
    if (writeBlocked || !activeTarget || !confirmedDevice) return;
    const targetId = target.deviceId;
    const reason = draft.reason;
    setConfirmedDevice(false); setRotationReview(null); setConfirmedRotation(false);
    await operation.run(async () => {
      await coordinator.revokeDevice(targetId, reason);
      if (isCurrent()) callbacks.current.onChanged();
      return { needsPublish: true, notice: `Access revoked for ${targetId} in this book. Rotate the book key, then publish a new snapshot.` };
    });
    if (isCurrent()) callbacks.current.onChanged();
  }
  async function rotate() {
    if (writeBlocked || !rotationReview || !confirmedRotation) return;
    const reviewed = rotationReview;
    const submitted = recovery.session.getSnapshot().value;
    const expectedLatest = recovery.session.getSnapshot().latest;
    setConfirmedRotation(false); setRotationReview(null);
    await operation.run(async () => {
      const result = await coordinator.provisionProjectKey(reviewed.previousVersion, reviewed.reason, reviewed.recipients);
      recovery.session.saved(submitted, { ...submitted, previousVersion: String(result.keyVersion), targetDeviceId: "", reviewIntent: undefined }, expectedLatest);
      if (isCurrent()) callbacks.current.onChanged();
      return { needsPublish: true, recoveryKey: result.recoveryKey, notice: `Book key ${result.keyVersion} created for ${result.envelopeCount} remaining devices. Publish a new snapshot explicitly.` };
    });
    if (isCurrent()) callbacks.current.onChanged();
  }

  if (!identity) return null;
  return <section aria-label="Trusted devices" style={{ display: "grid", gap: 10, minWidth: 0 }}>
    <h3 style={{ margin: 0, fontSize: "var(--text-sm)" }}>Trusted devices for this book</h3>
    <p style={small}>This desktop: <code>{identity.deviceId}</code><br />Companion account: <code>{identity.userId}</code></p>
    <p style={small}>Revocation stops new hosted access for this book. It cannot erase downloaded or decrypted offline copies, or undo requests already in progress. Rotate the key for remaining devices, then republish. Other books keep their own device access.</p>
    <button className="btn btn--sm" disabled={blocked} onClick={() => void refresh(true)}>Refresh trusted devices</button>
    {loading && <p role="status">Loading trusted devices…</p>}
    {loadError && <p role="alert">{loadError} The list is unavailable; device changes are blocked.</p>}
    {devices && <ul style={{ paddingLeft: 20, margin: 0 }}>{devices.map(device => <li key={device.deviceId} style={{ marginBottom: 10, overflowWrap: "anywhere" }}>
      <strong>{device.platform || "Device"}{device.deviceId === identity.deviceId ? " · This desktop" : ""}</strong><br />
      <code>{device.deviceId}</code><br />
      <span style={small}>Account {device.userId || "unavailable"} · Device key {device.deviceKeyVersion ?? "unavailable"}<br />
        {device.projectRevokedAt ? `Revoked for this book · ${device.projectRevokedAt}` : device.projectEnrolledAt ? "Trusted for this book" : "Not enrolled for this book"}</span>
    </li>)}</ul>}
    {recovery.error && <p role="alert">{recovery.error}</p>}
    {recovery.recovered && recovery.dirty && <p role="status">Recovered device-management draft. Refresh and review before making changes.</p>}
    <label style={field}>Reason<select className="select" value={draft.reason} disabled={blocked} onChange={event => updateDraft({ reason: event.target.value })}>
      <option value="lost-device">Lost device</option><option value="untrusted-device">Device no longer trusted</option><option value="routine-key-rotation">Routine key rotation</option>
    </select></label>
    <label style={field}>Device to revoke<select className="select" value={draft.targetDeviceId} disabled={blocked || !devices} onChange={event => updateDraft({ targetDeviceId: event.target.value })}>
      <option value="">Select a device</option>
      {draft.targetDeviceId && !devices?.some(device => device.deviceId === draft.targetDeviceId) && <option value={draft.targetDeviceId}>Unavailable device · {draft.targetDeviceId}</option>}
      {devices?.map(device => <option key={device.deviceId} value={device.deviceId} disabled={device.deviceId === identity.deviceId || device.projectRevokedAt !== null || device.projectEnrolledAt === null}>{device.platform || "Device"} · {device.deviceId}{device.deviceId === identity.deviceId ? " · This desktop" : device.projectRevokedAt ? " · Revoked" : ""}</option>)}
    </select></label>
    <p style={small}>To remove this desktop, use another trusted desktop. Revoked enrollment cannot be restored here; a replacement device needs a new identity.</p>
    {activeTarget && <label style={small}><input type="checkbox" checked={confirmedDevice} disabled={blocked} onChange={event => setConfirmedDevice(event.target.checked)} /> I intend to revoke <code>{target.deviceId}</code> for this book.</label>}
    <button className="btn btn--sm" disabled={writeBlocked || !activeTarget || !confirmedDevice} onClick={() => void revoke()}>Revoke selected device for this book</button>
    <label style={field}>Expected previous book key version<input className="input input--mono" inputMode="numeric" value={draft.previousVersion} disabled={blocked} onChange={event => updateDraft({ previousVersion: event.target.value })} /></label>
    <p style={small}>Use 0 for the first key. Rotation refuses a changed key version or recipient set; it never chooses a new version silently.</p>
    <button className="btn btn--sm" disabled={writeBlocked || !devices || !recipientKeys(devices).length || !/^(0|[1-9]\d*)$/.test(draft.previousVersion) || !Number.isSafeInteger(Number(draft.previousVersion)) || Number(draft.previousVersion) >= 2147483647}
      onClick={() => { updateDraft({ reviewIntent: true }); setRotationReview({ previousVersion: Number(draft.previousVersion), reason: draft.reason, recipients: recipientKeys(devices!) }); setConfirmedRotation(false); }}>Review book key rotation</button>
    {rotationReview && <div role="region" aria-label="Book key rotation review" style={{ overflowWrap: "anywhere" }}>
      <p>Replace book key {rotationReview.previousVersion} with key {rotationReview.previousVersion + 1}. Only these {rotationReview.recipients.length} devices receive the new key:</p>
      <ul>{rotationReview.recipients.map(recipient => <li key={recipient.deviceId}><code>{recipient.deviceId}</code><br /><span style={small}>Encryption key <code>{recipient.keyId}</code></span></li>)}</ul>
      <label style={small}><input type="checkbox" checked={confirmedRotation} disabled={blocked} onChange={event => setConfirmedRotation(event.target.checked)} /> I reviewed this version and every remaining device.</label>
      <button className="btn btn--sm" disabled={writeBlocked || !confirmedRotation} onClick={() => void rotate()}>Rotate book key for reviewed devices</button>
      <button className="btn btn--sm" disabled={blocked} onClick={() => { setRotationReview(null); setConfirmedRotation(false); }}>Cancel rotation review</button>
    </div>}
    {outcome.busy && <p role="status">Device operation in progress. Switching books does not cancel a submitted request.</p>}
    {outcome.error && <p role="alert">{outcome.error} Your draft remains here. The result may be unconfirmed; reconnect and refresh before retrying. No automatic retry was made.</p>}
    {outcome.notice && <p role="status">{outcome.notice}</p>}
    {outcome.needsPublish && <p role="status">A new snapshot must be published for remaining devices.</p>}
    {outcome.recoveryKey && <div style={{ overflowWrap: "anywhere" }}><p>Save this recovery key now. It is held only in memory for this account and book:</p><code>{outcome.recoveryKey}</code><br /><button className="btn btn--sm" disabled={outcome.busy} onClick={operation.forgetRecoveryKey}>Hide recovery key</button></div>}
    <button className="btn btn--sm" disabled={blocked} onClick={() => { recovery.session.useSaved(); setConfirmedDevice(false); setRotationReview(null); setConfirmedRotation(false); }}>Discard device-management draft</button>
  </section>;
}
const small = { margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-xs)", overflowWrap: "anywhere" } as const;
const field = { display: "grid", gap: 4, minWidth: 0, fontSize: "var(--text-xs)" } as const;
