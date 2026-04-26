const INVALID_GROUP_ID_TOKENS = new Set(['null', 'undefined']);

export const normalizeGroupId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (INVALID_GROUP_ID_TOKENS.has(trimmed.toLowerCase())) {
    return null;
  }

  if (trimmed.includes(':')) {
    return null;
  }

  return trimmed;
};

export const hasValidGroupId = (value) => Boolean(normalizeGroupId(value));
