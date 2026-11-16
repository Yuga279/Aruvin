/**
 * ============================================================================
 * FILE: tokens.test.ts
 * LOCATION: frontend/src/styles/tokens.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Enforce WCAG contrast for Aurvin colour tokens in both themes, and the
 *    data-theme contract that replaced OS-only light mode.
 *
 * ROLE IN PROJECT:
 *    Release 0 acceptance: text pairs >= 4.5:1, UI/focus pairs >= 3:1, the
 *    brand primary is never paired with white text in dark mode, every
 *    var(--aurvin-*) reference resolves to a definition, and no stylesheet
 *    keys light styling off the OS preference alone (which would ignore the
 *    user's choice).
 *
 * KEY COMPONENTS:
 *    - tokenBlock / contrast helpers (WCAG 2.x relative luminance)
 *    - Per-theme contrast matrix, defined-variable and data-theme checks
 * ============================================================================
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');

function tokenBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--aurvin-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = tokenBlock(':root');
const light = { ...dark, ...tokenBlock(":root[data-theme='light']") };

const TEXT_PAIRS: Array<[string, string]> = [
  ['text-primary', 'bg'],
  ['text-primary', 'surface'],
  ['text-primary', 'surface-elevated'],
  ['text-primary', 'user-bubble'],
  ['text-primary', 'code-bg'],
  ['text-secondary', 'bg'],
  ['text-secondary', 'surface'],
  ['text-secondary', 'surface-elevated'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hover'],
  ['primary', 'bg'],
  ['primary', 'surface-elevated'],
  ['danger', 'bg'],
  ['danger', 'surface-elevated'],
  ['warning', 'surface-elevated'],
  ['success', 'surface-elevated'],
  ['secondary', 'surface-elevated'],
];

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme tokens', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s meets 4.5:1', (fg, bg) => {
    expect(tokens[fg], fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tokens[bg], bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('focus ring (primary) meets 3:1 against every surface', () => {
    for (const bg of ['bg', 'surface', 'surface-elevated']) {
      expect(contrast(tokens.primary, tokens[bg])).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('token contracts', () => {
  it('keeps the specified dark brand values', () => {
    expect(dark).toMatchObject({
      bg: '#0B0E14', surface: '#111722', 'surface-elevated': '#1A2230', primary: '#7485FF',
      secondary: '#9B7BFF', success: '#35C99A', warning: '#E9B75C', danger: '#F07178',
      'text-primary': '#F4F6FA', 'text-secondary': '#A0A9B8', 'radius-sm': '8px', 'radius-md': '12px',
      'radius-lg': '18px',
    });
  });

  it('never puts white text on the dark-theme primary (about 3.2:1, fails AA)', () => {
    expect(contrast('#FFFFFF', dark.primary)).toBeLessThan(4.5);
    expect(dark['on-primary'].toUpperCase()).not.toBe('#FFFFFF');
  });

  it('drives light styling from data-theme, not the OS preference alone', () => {
    const cssFiles = sourceFiles('.css');
    expect(cssFiles.length).toBeGreaterThan(5);
    for (const file of cssFiles) {
      expect(readFileSync(file, 'utf-8'), file).not.toContain('prefers-color-scheme');
    }
  });

  it('defines every var(--aurvin-*) referenced in styles or components', () => {
    // Set from JavaScript at runtime (PromptTraveler), so it has no stylesheet definition.
    const runtimeOnly = new Set(['--aurvin-prompt-travel-pad']);
    const defined = new Set<string>();
    for (const file of sourceFiles('.css')) {
      for (const m of readFileSync(file, 'utf-8').matchAll(/(--aurvin-[\w-]+)\s*:/g)) defined.add(m[1]);
    }
    const missing = new Set<string>();
    for (const file of [...sourceFiles('.css'), ...sourceFiles('.tsx'), ...sourceFiles('.ts')]) {
      for (const m of readFileSync(file, 'utf-8').matchAll(/var\((--aurvin-[\w-]+)/g)) {
        if (!defined.has(m[1]) && !runtimeOnly.has(m[1])) missing.add(`${m[1]} in ${file}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

function sourceFiles(extension: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(extension) && !path.endsWith('.test.ts')) out.push(path);
    }
  };
  walk(fileURLToPath(new URL('..', import.meta.url)));
  return out;
}
