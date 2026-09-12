const PREFIX = "OA1";

function crc32(value: string): string {
  let crc = 0xffffffff;
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index);
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function canonicalBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(padded)) {
    throw new Error("Recovery key must encode exactly 32 bytes.");
  }
  return padded;
}

export async function encodeRecoveryKey(projectKeyBase64: string): Promise<string> {
  const canonical = canonicalBase64(projectKeyBase64);
  const body = canonical.slice(0, -1).replace(/\+/g, "-").replace(/\//g, "_");
  return `${PREFIX}-${body}.${crc32(body)}`;
}

export async function decodeRecoveryKey(recoveryKey: string): Promise<string> {
  const compact = recoveryKey.trim();
  if (!compact.startsWith(`${PREFIX}-`)) throw new Error("Recovery key version is unsupported.");
  const separator = compact.lastIndexOf(".");
  if (separator < PREFIX.length + 2) throw new Error("Recovery key is incomplete.");
  const checksum = compact.slice(separator + 1);
  const body = compact.slice(PREFIX.length + 1, separator);
  if (!/^[A-Za-z0-9_-]{43}$/.test(body)) throw new Error("Recovery key format is invalid.");
  if (crc32(body) !== checksum.toUpperCase()) throw new Error("Recovery key checksum does not match.");
  return canonicalBase64(`${body}=`);
}
