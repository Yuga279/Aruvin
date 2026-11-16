/**
 * ============================================================================
 * FILE: redact.ts
 * LOCATION: backend/src/platform/security/redact.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Redact credential-bearing keys and common secret values from log data.
 *
 * ROLE IN PROJECT:
 *    Provides a shared safety primitive for structured logs while preserving
 *    ordinary non-secret text and values.
 *
 * KEY COMPONENTS:
 *    - redactSecrets: Recursively redacts objects, arrays, and strings.
 *    - Secret patterns: Recognize keys, bearer tokens, API keys, and Mongo URIs.
 * ============================================================================
 */

const SECRET_KEY =
  /api[_-]?key|authorization|password|secret|mongo(?:db)?_?uri|connectionstring|(?:participant|access)[_-]?token/i;
const SECRET_VALUE =
  /(?:(?<![a-zA-Z])sk-[a-zA-Z0-9-]+)|(?:Bearer\s+[A-Za-z0-9._-]+)|(?:mongodb(?:\+srv)?:\/\/[^\s]+)|(?:\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/gi;

function redactString(value: string): string {
  SECRET_VALUE.lastIndex = 0;
  const redacted = value.replace(SECRET_VALUE, '[redacted]');
  SECRET_VALUE.lastIndex = 0;
  return redacted;
}

export function redactSecrets(input: unknown): unknown {
  if (typeof input === 'string') {
    return redactString(input);
  }
  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }
  if (input && typeof input === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = SECRET_KEY.test(key) ? '[redacted]' : redactSecrets(value);
    }
    return output;
  }
  return input;
}
