import './setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './setup.ts';
import { seal, open } from '../src/lib/crypto.ts';
import { getDb } from '../src/db/index.ts';
import * as repo from '../src/db/repos.ts';

test('seal/open roundtrips and does not leak plaintext', () => {
  const secret = 'sk-super-secret-provider-key-123456';
  const sealed = seal(secret);
  assert.notEqual(sealed.ciphertext, secret);
  assert.ok(!sealed.ciphertext.includes('super-secret'));
  assert.equal(open(sealed), secret);
});

test('tampered ciphertext fails auth (GCM)', () => {
  const sealed = seal('hello');
  const bad = { ...sealed, ciphertext: Buffer.from('tampered').toString('base64') };
  assert.throws(() => open(bad));
});

test('BYOK key stored encrypted — no plaintext in DB (G-01)', () => {
  freshDb();
  const plaintext = 'sk-ant-plaintext-should-never-persist-0000';
  repo.upsertApiKey('anthropic', plaintext, 'my key');

  const row = getDb()
    .prepare('SELECT ciphertext, iv, auth_tag, last4 FROM api_keys WHERE provider = ?')
    .get('anthropic') as { ciphertext: string; iv: string; auth_tag: string; last4: string };

  assert.ok(!row.ciphertext.includes('plaintext'));
  assert.ok(!row.ciphertext.includes(plaintext));
  assert.equal(row.last4, '0000');

  // full-table dump must not contain the plaintext anywhere
  const dump = JSON.stringify(
    getDb().prepare('SELECT * FROM api_keys').all(),
  );
  assert.ok(!dump.includes(plaintext), 'plaintext key leaked into api_keys');

  // but it decrypts back correctly for internal use
  assert.equal(repo.getDecryptedKey('anthropic'), plaintext);
});

test('key list metadata never includes key material', () => {
  freshDb();
  repo.upsertApiKey('openai', 'sk-openai-abcdefgh', '');
  const meta = repo.listKeyMeta();
  const json = JSON.stringify(meta);
  assert.ok(!json.includes('abcdefgh'));
  assert.ok(json.includes('efgh')); // last4 shown
});
