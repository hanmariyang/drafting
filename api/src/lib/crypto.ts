import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

// AES-256-GCM at-rest encryption for BYOK provider keys (G-01: never plaintext).

const ALGO = 'aes-256-gcm';

export interface Sealed {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

let cachedKey: Buffer | null = null;

/**
 * Resolve the 32-byte master key. Priority:
 *   1. APP_ENCRYPTION_KEY env (base64 or hex decoding to exactly 32 bytes)
 *   2. Persisted data/master.key (generated on first boot, chmod 600)
 * Generating-and-persisting keeps a fresh install zero-config while still
 * surviving restarts. Set APP_ENCRYPTION_KEY in prod so keys survive a wipe.
 */
export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = config.encryptionKey.trim();
  if (fromEnv) {
    const buf = decodeKey(fromEnv);
    if (buf.length !== 32) {
      throw new Error(
        `APP_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). ` +
          `Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    cachedKey = buf;
    return buf;
  }

  const keyFile = path.join(path.dirname(config.databasePath), 'master.key');
  if (fs.existsSync(keyFile)) {
    cachedKey = decodeKey(fs.readFileSync(keyFile, 'utf8').trim());
    return cachedKey;
  }

  const generated = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, generated.toString('base64'), { mode: 0o600 });
  fs.chmodSync(keyFile, 0o600);
  cachedKey = generated;
  return generated;
}

function decodeKey(s: string): Buffer {
  // try base64 then hex
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  return Buffer.from(s, 'base64');
}

export function seal(plaintext: string): Sealed {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function open(sealed: Sealed): string {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(
    ALGO,
    key,
    Buffer.from(sealed.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

/** Reset cached key — test-only. */
export function _resetKeyCache(): void {
  cachedKey = null;
}
