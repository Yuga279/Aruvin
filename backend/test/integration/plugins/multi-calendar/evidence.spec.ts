/**
 * ============================================================================
 * FILE: evidence.spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/evidence.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Keep multi-calendar acceptance evidence linked and explicitly gate-qualified.
 * ROLE IN PROJECT:
 *    Guards document consistency only, never certifies the application or service.
 *    Prevents omitted acceptance rows or silently omitted required live gates.
 * KEY COMPONENTS:
 *    - Evidence paths: Required documents and local links exist.
 *    - Acceptance map: Every AC and skipped-review/pending-gate language is present.
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(process.cwd(), '../docs/google-calendar-multi-calendar');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');
it('records every acceptance criterion and named evidence class without broken local links', () => {
  const verification = read('verification.md');
  const staging = read('staging-evidence.md');
  const report = read('final_report.md');
  const ids = Array.from({ length: 14 }, (_, i) => `AC${String(i + 1).padStart(2, '0')}`);
  for (const id of ids) expect(verification).toContain(`| ${id} |`);
  for (const text of [verification, staging, report]) {
    expect(text).toMatch(/skipped, not passed/iu);
    expect(text).toMatch(/pending|blocked|unrun|satisfied/iu);
  }
  for (const gate of ['P9-NATIVE', 'P9-BROWSER', 'P9-ACCESSIBILITY', 'P9-LIVE-CONSENT',
    'P9-LIVE-ACL', 'P9-LIVE-BUSY', 'P9-LIVE-RETRY', 'P9-LIVE-QUOTA', 'P9-REAL-DATA-POLICY']) {
    expect(staging).toContain(gate);
    expect(verification).toContain(gate);
  }
  for (const name of ['verification.md', 'staging-evidence.md', 'final_report.md']) {
    for (const match of read(name).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (/^(?:https?:|mailto:|#)/u.test(match[1])) continue;
      const path = decodeURIComponent(match[1].split('#')[0]);
      expect(existsSync(resolve(dirname(resolve(root, name)), path)), `${name}: ${path}`).toBe(true);
    }
  }
});
