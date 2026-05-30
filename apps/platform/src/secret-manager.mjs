import { randomUUID } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

const REDACTION_RULES = [
  {
    label: 'bearer_token',
    pattern: /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
    replacement: 'Bearer [REDACTED:bearer_token]',
  },
  {
    label: 'api_key',
    pattern: /\bsk-[A-Za-z0-9]{16,}\b/g,
    replacement: '[REDACTED:api_key]',
  },
  {
    label: 'credential_assignment',
    pattern: /\b((?:access[_ -]?token|refresh[_ -]?token|api[_ -]?key|password|secret)\s*[:=]\s*)([^\s"'`]+)/gi,
    replacement: (_, prefix) => `${prefix}[REDACTED:credential]`,
  },
];

const SENSITIVE_KEY_PATTERN = /(?:access[_ -]?token|refresh[_ -]?token|api[_ -]?key|password|secret|authorization|bearer|token)/i;

function shouldRedactKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key ?? ''));
}

function redactSensitiveValue(value) {
  if (typeof value === 'string') {
    const redacted = redactText(value);
    return redacted === value ? '[REDACTED:credential]' : redacted;
  }

  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return '[REDACTED:credential]';
  }

  return '[REDACTED:credential]';
}

export function redactText(value) {
  let text = String(value ?? '');
  for (const rule of REDACTION_RULES) {
    text = text.replace(rule.pattern, rule.replacement);
  }
  return text;
}

export function hasSecrets(value) {
  return redactText(value) !== String(value ?? '');
}

export function redactValue(value) {
  if (typeof value === 'string') {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        shouldRedactKey(key) ? redactSensitiveValue(item) : redactValue(item),
      ]),
    );
  }

  return value;
}

export function redactCanonicalMessage(message) {
  const cloned = clone(message);
  if (Array.isArray(cloned.content)) {
    cloned.content = cloned.content.map((part) => {
      if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
        return {
          ...part,
          text: redactText(part.text),
        };
      }

      return redactValue(part);
    });
  }

  if (Array.isArray(cloned.attachments)) {
    cloned.attachments = cloned.attachments.map((attachment) => redactValue(attachment));
  }

  if (Array.isArray(cloned.quoted_messages)) {
    cloned.quoted_messages = cloned.quoted_messages.map((item) => redactValue(item));
  }

  if (cloned.metadata) {
    cloned.metadata = redactValue(cloned.metadata);
  }

  return cloned;
}

export function createSecretManager() {
  function sanitizeText(text) {
    return redactText(text);
  }

  function sanitizeValue(value) {
    return redactValue(value);
  }

  function sanitizeMessage(message) {
    return redactCanonicalMessage(message);
  }

  function generateRedactionId() {
    return `secret_${randomUUID()}`;
  }

  return {
    sanitizeText,
    sanitizeValue,
    sanitizeMessage,
    hasSecrets,
    generateRedactionId,
  };
}
