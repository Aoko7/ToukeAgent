import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecretManager, redactCanonicalMessage, redactValue } from '../apps/platform/src/secret-manager.mjs';

test('secret manager redacts text secrets and structured credential fields', () => {
  const manager = createSecretManager();
  const text = manager.sanitizeText('Bearer sk-1234567890abcdef1234567890abcdef api_key=abc password=xyz secret=foo');

  assert.equal(text, 'Bearer [REDACTED:bearer_token] api_key=[REDACTED:credential] password=[REDACTED:credential] secret=[REDACTED:credential]');
  assert.equal(manager.hasSecrets('sk-1234567890abcdef1234567890abcdef'), true);
  assert.equal(manager.hasSecrets('clean text'), false);

  const redacted = redactCanonicalMessage({
    content: [{ type: 'text', text: 'use sk-1234567890abcdef1234567890abcdef token' }],
    attachments: [{ url: 'https://example.com?api_key=abc' }],
    quoted_messages: [{ text: 'Bearer sk-1234567890abcdef1234567890abcdef' }],
    metadata: {
      password: 'plain-password',
      secret: { token: 'nested' },
      authorization: 'Bearer sk-1234567890abcdef1234567890abcdef',
      nested: { api_key: 'abc' },
    },
  });

  assert.equal(redacted.content[0].text, 'use [REDACTED:api_key] token');
  assert.equal(redacted.attachments[0].url, 'https://example.com?api_key=[REDACTED:credential]');
  assert.equal(redacted.quoted_messages[0].text, 'Bearer [REDACTED:bearer_token]');
  assert.equal(redacted.metadata.password, '[REDACTED:credential]');
  assert.equal(redacted.metadata.secret, '[REDACTED:credential]');
  assert.equal(redacted.metadata.authorization, 'Bearer [REDACTED:bearer_token]');
  assert.equal(redacted.metadata.nested.api_key, '[REDACTED:credential]');

  const nested = redactValue({ token: 'abc', nested: { password: 'def' } });
  assert.equal(nested.token, '[REDACTED:credential]');
  assert.equal(nested.nested.password, '[REDACTED:credential]');
});
