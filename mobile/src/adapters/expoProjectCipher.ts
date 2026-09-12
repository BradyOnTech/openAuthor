import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  CryptoDigestAlgorithm,
  digestStringAsync,
} from "expo-crypto";

import type { OutboxCipher, OutboxEnvelope, OutboxKind } from "../core/outbox";
import type { OutboxReadCipher } from "../core/outboxReview";
import type { SnapshotCipher } from "../core/snapshotSync";

function standardBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
}

async function keyFromBase64(value: string): Promise<AESEncryptionKey> {
  return await AESEncryptionKey.import(standardBase64(value), "base64");
}

function snapshotAdditionalData(context: {
  projectId: string;
  revision: string;
  keyVersion: number;
}): Uint8Array {
  return new TextEncoder().encode(
    `openauthor.snapshot.v1|${context.projectId}|${context.revision}|${context.keyVersion}`,
  );
}

export class ExpoSnapshotCipher implements SnapshotCipher {
  async digest(value: string): Promise<string> {
    return await digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
  }

  async open(
    ciphertext: string,
    projectKey: string,
    context: { projectId: string; revision: string; keyVersion: number },
  ): Promise<string> {
    const key = await keyFromBase64(projectKey);
    const sealed = AESSealedData.fromCombined(ciphertext);
    const plaintext = await aesDecryptAsync(sealed, key, {
      additionalData: snapshotAdditionalData(context),
    });
    if (typeof plaintext === "string") {
      throw new Error("Snapshot decrypt returned an unexpected encoding.");
    }
    return new TextDecoder().decode(plaintext);
  }
}

function outboxAdditionalData(context: {
  projectId: string;
  deviceId: string;
  operationId: string;
  baseRevision: string;
  kind: OutboxKind;
  keyVersion: number;
}): Uint8Array {
  return new TextEncoder().encode([
    "openauthor.mobile.outbox.v1",
    context.projectId,
    context.deviceId,
    context.operationId,
    context.baseRevision,
    context.kind,
    String(context.keyVersion),
  ].join("\0"));
}

export class ExpoOutboxCipher implements OutboxCipher, OutboxReadCipher {
  constructor(
    private readonly projectKey: string,
    private readonly keyVersion: number,
  ) {
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
      throw new Error("Outbox key version is invalid.");
    }
  }

  async fingerprint(plaintext: string): Promise<string> {
    return await digestStringAsync(CryptoDigestAlgorithm.SHA256, plaintext);
  }

  async seal(plaintext: string, context: {
    projectId: string;
    deviceId: string;
    operationId: string;
    baseRevision: string;
    kind: OutboxKind;
  }): Promise<{
    ciphertext: string;
    ciphertextDigest: string;
    keyVersion: number;
  }> {
    const key = await keyFromBase64(this.projectKey);
    const sealed = await aesEncryptAsync(
      new TextEncoder().encode(plaintext),
      key,
      { additionalData: outboxAdditionalData({ ...context, keyVersion: this.keyVersion }) },
    );
    const ciphertext = await sealed.combined("base64");
    if (typeof ciphertext !== "string") throw new Error("Outbox encryption failed.");
    return {
      ciphertext,
      ciphertextDigest: await digestStringAsync(CryptoDigestAlgorithm.SHA256, ciphertext),
      keyVersion: this.keyVersion,
    };
  }

  async open(envelope: OutboxEnvelope): Promise<string> {
    if (envelope.keyVersion !== this.keyVersion) throw new Error("Outbox key version does not match.");
    const plaintext = await aesDecryptAsync(
      AESSealedData.fromCombined(envelope.ciphertext),
      await keyFromBase64(this.projectKey),
      { additionalData: outboxAdditionalData(envelope) },
    );
    if (typeof plaintext === "string") throw new Error("Outbox decrypt returned an unexpected encoding.");
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  }
}
