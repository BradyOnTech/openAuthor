import sodium from "libsodium-wrappers";
import type { DeviceCrypto } from "../core/deviceEnrollment";

export class SodiumDeviceCrypto implements DeviceCrypto {
  async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    await sodium.ready;
    const pair = sodium.crypto_box_keypair();
    return { publicKey: sodium.to_base64(pair.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING), privateKey: sodium.to_base64(pair.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING) };
  }
  async openSealedProjectKey(input: { envelope: string; publicKey: string; privateKey: string }): Promise<string> {
    await sodium.ready;
    const decode = (value: string, size: number) => {
      const bytes = sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
      if (bytes.length !== size) throw new Error("Sealed project key encoding is invalid.");
      return bytes;
    };
    const key = sodium.crypto_box_seal_open(decode(input.envelope, 80), decode(input.publicKey, 32), decode(input.privateKey, 32));
    if (key.length !== 32) throw new Error("Opened project key must be 32 bytes.");
    return sodium.to_base64(key, sodium.base64_variants.URLSAFE_NO_PADDING);
  }
}
