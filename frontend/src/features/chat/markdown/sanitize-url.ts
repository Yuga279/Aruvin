/**
 * ============================================================================
 * FILE: sanitize-url.ts
 * LOCATION: frontend/src/features/chat/markdown/sanitize-url.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Whitelist safe URL schemes before rendering Markdown links.
 *
 * ROLE IN PROJECT:
 *    Prevents javascript:, data:, vbscript:, and file: payloads from reaching
 *    href attributes while allowing http, https, mailto, and in-page paths.
 *
 * KEY COMPONENTS:
 *    - sanitizeUrl: Returns the original URL or an empty string when unsafe.
 * ============================================================================
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (SAFE_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return trimmed;
    }
    return '';
  } catch {
    return '';
  }
}
