export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assert(condition, message) {
  if (!condition) {
    throw new TypeError(message);
  }
}

export function asString(value, name) {
  assert(typeof value === 'string' && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

export function asOptionalString(value, name) {
  if (value === undefined || value === null) return null;
  assert(typeof value === 'string', `${name} must be a string`);
  return value;
}

export function asBoolean(value, name, fallback = false) {
  if (value === undefined || value === null) return fallback;
  assert(typeof value === 'boolean', `${name} must be a boolean`);
  return value;
}

export function asNumber(value, name, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  assert(typeof value === 'number' && Number.isFinite(value), `${name} must be a finite number`);
  return value;
}

export function asObject(value, name, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  assert(isPlainObject(value), `${name} must be an object`);
  return value;
}

export function asArray(value, name, fallback = []) {
  if (value === undefined || value === null) return fallback;
  assert(Array.isArray(value), `${name} must be an array`);
  return value;
}

export function clone(value) {
  return structuredClone(value);
}
