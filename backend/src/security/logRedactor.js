'use strict';

const GITHUB_PAT_REGEX = /\bghp_[A-Za-z0-9]{20,}\b/g;
const AUTHORIZATION_BEARER_REGEX = /(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi;
const AUTHORIZATION_BASIC_REGEX = /(Authorization\s*:\s*Basic\s+)[A-Za-z0-9+/=]+/gi;
const JSON_BEARER_REGEX = /("authorization"\s*:\s*"Bearer\s+)[^"]+/gi;
const JSON_BASIC_REGEX = /("authorization"\s*:\s*"Basic\s+)[^"]+/gi;
const BEARER_PREFIX_REGEX = /^Bearer\s+/i;
const BASIC_PREFIX_REGEX = /^Basic\s+/i;
const SENSITIVE_KEY_REGEX =
  /(^|_)(authorization|token|secret|password|pat|api[_-]?key|api[_-]?token|cookie|set-cookie)$/i;

function redactString(value) {
  if (!value || typeof value !== 'string') return value;

  return value
    .replace(GITHUB_PAT_REGEX, '[REDACTED]')
    .replace(AUTHORIZATION_BEARER_REGEX, '$1[REDACTED]')
    .replace(AUTHORIZATION_BASIC_REGEX, '$1[REDACTED]')
    .replace(JSON_BEARER_REGEX, '$1[REDACTED]')
    .replace(JSON_BASIC_REGEX, '$1[REDACTED]');
}

function redactSensitiveValue(value) {
  if (typeof value === 'string') return '[REDACTED]';
  if (Array.isArray(value)) return value.map(() => '[REDACTED]');
  return '[REDACTED]';
}

function redactObject(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, seen));
  }

  const copy = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = String(key || '').trim();
    if (SENSITIVE_KEY_REGEX.test(normalizedKey)) {
      if (typeof nested === 'string') {
        if (BEARER_PREFIX_REGEX.test(nested)) {
          copy[key] = 'Bearer [REDACTED]';
          continue;
        }
        if (BASIC_PREFIX_REGEX.test(nested)) {
          copy[key] = 'Basic [REDACTED]';
          continue;
        }
      }
      copy[key] = redactSensitiveValue(nested);
      continue;
    }

    copy[key] = redactObject(nested, seen);
  }
  return copy;
}

function redactAny(value) {
  if (typeof value === 'string') return redactString(value);
  if (value && typeof value === 'object') return redactObject(value);
  return value;
}

module.exports = {
  redactAny,
  redactString,
};
