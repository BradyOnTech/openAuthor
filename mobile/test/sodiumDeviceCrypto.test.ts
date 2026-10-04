import {
  base64_variants,
  crypto_box_seal,
  from_base64,
  ready,
  to_base64,
} from "react-native-libsodium";
import { describe, expect, it } from "vitest";

import { SodiumDeviceCrypto } from "../src/adapters/sodiumDeviceCrypto";

describe("SodiumDeviceCrypto", () => {
  it("opens one complete 80-byte sealed-box envelope to a 32-byte project key", async () => {
    await ready;
    const crypto = new SodiumDeviceCrypto();
    const pair = await crypto.generateKeyPair();
    const projectKey = new Uint8Array(32).fill(0x42);
    const envelope = to_base64(
      crypto_box_seal(
        projectKey,
        from_base64(pair.publicKey, base64_variants.URLSAFE_NO_PADDING),
      ),
      base64_variants.URLSAFE_NO_PADDING,
    );

    expect(from_base64(envelope, base64_variants.URLSAFE_NO_PADDING)).toHaveLength(80);
    expect(from_base64(
      await crypto.openSealedProjectKey({...pair, envelope}),
      base64_variants.URLSAFE_NO_PADDING,
    )).toEqual(projectKey);
  });

  it("rejects malformed key and envelope lengths before opening", async () => {
    const crypto = new SodiumDeviceCrypto();
    const encoded = (bytes: Uint8Array) => to_base64(
      bytes,
      base64_variants.URLSAFE_NO_PADDING,
    );
    const short = encoded(new Uint8Array(31));
    const key = encoded(new Uint8Array(32));
    const envelope = encoded(new Uint8Array(80));

    await expect(crypto.openSealedProjectKey({envelope, publicKey: short, privateKey: key}))
      .rejects.toThrow("public key");
    await expect(crypto.openSealedProjectKey({envelope: short, publicKey: key, privateKey: key}))
      .rejects.toThrow("envelope");
  });
});
