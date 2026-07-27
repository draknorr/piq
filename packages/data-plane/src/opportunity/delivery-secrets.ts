import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface EncryptedPayload {
  algorithm: "aes-256-gcm";
  authTag: string;
  ciphertext: string;
  iv: string;
  version: 1;
}

function decodeKey(encodedKey: string): Buffer {
  const trimmed = encodedKey.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error(
      "OPPORTUNITY_DELIVERY_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return key;
}

export class OpportunityDestinationCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = decodeKey(encodedKey);
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const payload: EncryptedPayload = {
      algorithm: "aes-256-gcm",
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      version: 1,
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  }

  decrypt(encodedPayload: string): string {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64").toString("utf8"),
    ) as EncryptedPayload;
    if (payload.version !== 1 || payload.algorithm !== "aes-256-gcm") {
      throw new Error(
        "Unsupported opportunity destination ciphertext version.",
      );
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(payload.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function loadOpportunityDestinationCipher(
  env: NodeJS.ProcessEnv = process.env,
): OpportunityDestinationCipher | null {
  const key = env.OPPORTUNITY_DELIVERY_ENCRYPTION_KEY;
  return key ? new OpportunityDestinationCipher(key) : null;
}
