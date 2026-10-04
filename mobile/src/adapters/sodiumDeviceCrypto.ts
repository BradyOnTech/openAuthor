import {
  base64_variants,
  crypto_box_keypair,
  crypto_box_seal_open,
  from_base64,
  ready,
  to_base64,
} from "react-native-libsodium";

import type { DeviceCrypto } from "../core/deviceEnrollment";

export class SodiumDeviceCrypto implements DeviceCrypto {
  async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    await ready;
    const pair = crypto_box_keypair();
    return {
      publicKey: to_base64(pair.publicKey, base64_variants.URLSAFE_NO_PADDING),
      privateKey: to_base64(pair.privateKey, base64_variants.URLSAFE_NO_PADDING),
    };
  }

  async openSealedProjectKey(input: {
    envelope: string;
    publicKey: string;
    privateKey: string;
  }): Promise<string> {
    await ready;
    const decode = (value: string, label: string, expectedLength: number): Uint8Array => {
      let bytes: Uint8Array;
      try {
        bytes = from_base64(value, base64_variants.URLSAFE_NO_PADDING);
      } catch {
        throw new Error(`Sealed-box ${label} is not valid base64.`);
      }
      if (bytes.length !== expectedLength) {
        throw new Error(`Sealed-box ${label} must be ${expectedLength} bytes.`);
      }
      return bytes;
    };
    const envelope = decode(input.envelope, "envelope", 80);
    const publicKey = decode(input.publicKey, "public key", 32);
    const privateKey = decode(input.privateKey, "private key", 32);
    const projectKey = crypto_box_seal_open(envelope, publicKey, privateKey);
    if (projectKey.length !== 32) {
      throw new Error("Opened project key must be 32 bytes.");
    }
    return to_base64(projectKey, base64_variants.URLSAFE_NO_PADDING);
  }
}
