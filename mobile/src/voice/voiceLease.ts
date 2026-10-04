export type VoiceLease = {
  leaseId: string;
  expiresAt: string;
  leaseExpiresAt: string;
  renewAfterMs: number;
};

/** A lease is authority for one gateway-owned call, never for a client call ID. */
export function readVoiceLease(value: unknown, now = Date.now()): VoiceLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Voice policy is incomplete.");
  const row = value as Record<string, unknown>;
  const { lease_id: leaseId, expires_at: expiresAt, lease_expires_at: leaseExpiresAt, renew_after_ms: renewAfterMs } = row;
  const date = (input: unknown): number => typeof input === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input) ? Date.parse(input) : NaN;
  const hard = date(expiresAt), short = date(leaseExpiresAt);
  if (typeof leaseId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(leaseId)
    || !Number.isFinite(hard) || !Number.isFinite(short) || hard <= now || short <= now || short > hard
    || typeof renewAfterMs !== "number" || !Number.isSafeInteger(renewAfterMs) || renewAfterMs < 1 || renewAfterMs > 10_000) {
    throw new Error("Voice policy is invalid or expired. Start a new session to continue.");
  }
  return { leaseId, expiresAt: expiresAt as string, leaseExpiresAt: leaseExpiresAt as string, renewAfterMs };
}

export function leaseWire(value: VoiceLease): Record<string, unknown> {
  return { lease_id: value.leaseId, expires_at: value.expiresAt, lease_expires_at: value.leaseExpiresAt, renew_after_ms: value.renewAfterMs };
}
