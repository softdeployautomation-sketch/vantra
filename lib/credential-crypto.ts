import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

import { env } from "./env";

// Task 25 — deterministic, audited encryption for device credentials AT REST.
//
// This is the ONLY secure-storage mechanism for credentials in the app today
// (the codebase had no existing vault/encryption layer to reuse, so we built the
// minimal, standard one). Uses AES-256-GCM (authenticated encryption) with a
// fresh random 12-byte nonce per encryption — ciphertexts are non-deterministic,
// so identical PINs across devices never share a ciphertext and a DB leak cannot
// reveal equality.
//
// Layout of `encryptSecret`'s output (single base64 string stored in the DB):
//   base64( nonce (12) || tag (16) || ciphertext )
//   = 28 bytes overhead before the actual ciphertext.
//
// The key is CREDENTIALS_ENCRYPTION_KEY (32 random bytes, base64) — OPTIONAL at
// boot, but every store/read call fails CLOSED (throws) while it's unset so a
// misconfigured deployment can NEVER fall back to storing plaintext.

const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function keyBytes(): Buffer {
  const raw = env.credentialsEncryptionKey;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set — refusing to encrypt a device credential.",
    );
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is not valid base64.");
  }
  if (bytes.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return bytes;
}

export function encryptSecret(plaintext: string): string {
  const key = keyBytes();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const key = keyBytes();
  let raw: Buffer;
  try {
    raw = Buffer.from(payload, "base64");
  } catch {
    throw new Error("Stored credential is corrupt (not base64).");
  }
  const minLen = NONCE_BYTES + TAG_BYTES + 1;
  if (raw.length < minLen) {
    throw new Error("Stored credential is corrupt (too short).");
  }
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error("Stored credential failed authentication (key mismatch or tampering).");
  }
}

// Constant-time SHA-256 hex digest. Used for one-time callback tokens so the raw
// token is never persisted (a DB leak exposes only unusable hashes).
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// 32 random bytes → URL-safe base64 (no padding). Used as one-time callback
// tokens for the agent-side credential submission.
export function randomToken(): string {
  return randomBytes(32).toString("base64url").replace(/=+$/, "");
}
