/**
 * ============================================================================
 * FILE: styles.test.ts
 * LOCATION: frontend/src/styles/styles.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate design tokens, layout classes, and accessibility utilities.
 *
 * ROLE IN PROJECT:
 *    Node-side stylesheet contract check so light/dark tokens, the mobile
 *    drawer breakpoint, and sr-only focus helpers cannot drift silently.
 *
 * KEY COMPONENTS:
 *    - index.css token assertions
 *    - chat.css layout and media-query assertions
 *    - scrollbars.css hover-reveal contract
 *    - Text-only generating shimmer and reduced motion
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('styling tokens and stylesheets', () => {
  it('defines core css variables in tokens.css and utilities in index.css', () => {
    const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8');
    for (const name of ['bg', 'surface-elevated', 'text-primary', 'primary', 'border']) {
      expect(tokensCss).toContain(`--aurvin-${name}:`);
    }
    const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf-8');
    expect(indexCss).toContain('.sr-only');
    expect(indexCss).toContain(':focus-visible');
  });

  it('defines responsive drawer and chat container in chat.css', () => {
    const chatCss = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    expect(chatCss).toContain('.aurvin-layout');
    expect(chatCss).toContain('.aurvin-sidebar');
    expect(chatCss).toContain('.aurvin-main');
    expect(chatCss).toContain('.aurvin-composer');
    expect(chatCss).toContain('@media (max-width: 768px)');
  });

  it('scopes the generating shine to the placeholder text', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const base = css.match(/\.aurvin-generating-placeholder\s*\{([^}]*)\}/)?.[1];
    expect(base).toContain('display: inline-block;');
    expect(base).toContain('color: var(--aurvin-text-secondary);');
    expect(base).not.toContain('margin-top:');
    expect(css).toContain('@supports ((background-clip: text) or (-webkit-background-clip: text))');
    const shine = css.match(/\.aurvin-generating-placeholder\s*\{([^}]*animation: aurvin-generating-shimmer[^}]*)\}/)?.[1];
    expect(shine).toContain('background-image: linear-gradient(');
    expect(shine).toContain('background-size: 200% 100%;');
    expect(shine).toContain('background-clip: text;');
    expect(shine).toContain('-webkit-background-clip: text;');
    expect(shine).toContain('animation: aurvin-generating-shimmer 2s linear infinite;');
    expect(css).toMatch(/@keyframes aurvin-generating-shimmer\s*\{\s*from\s*\{\s*background-position: 200% 0;/);
    expect(css).toMatch(/to\s*\{\s*background-position: -200% 0;/);
    const animatedSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*animation: aurvin-generating-shimmer[^{}]*\}/g)]
      .map((match) => match[1].trim());
    expect(animatedSelectors).toEqual(['.aurvin-generating-placeholder']);
  });

  it('makes reduced-motion Generating static and readable', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const reduced = css.match(
      /@media\s*\(prefers-reduced-motion: reduce\)\s*\{\s*\.aurvin-generating-placeholder\s*\{([^}]*)\}/,
    )?.[1];
    expect(reduced).toContain('animation: none;');
    expect(reduced).toContain('background: none;');
    expect(reduced).toContain('color: var(--aurvin-text-secondary);');
    expect(reduced).toContain('-webkit-text-fill-color: currentColor;');
  });

  it('places copy actions under user and assistant messages and hides user copy until hover', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    expect(css).toContain('.aurvin-copy-btn');
    expect(css).toContain('.aurvin-message-actions');
    expect(css).toContain('.aurvin-copy-tooltip');
    expect(css).toContain('.aurvin-message-user {');
    expect(css).toContain('flex-direction: column;');
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    expect(css).toContain('.aurvin-message-user .aurvin-copy-btn');
    expect(css).toContain('.aurvin-message-user:hover .aurvin-copy-btn');
  });

  it('hides session options until row hover/focus/open, removes assistant avatar, and prevents scroll button squishing', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    expect(css).not.toContain('.aurvin-avatar');
    const options = css.match(/\.aurvin-session-options\s*\{([^}]*)\}/)?.[1];
    expect(options).toContain('opacity: 0;');
    expect(options).toContain('pointer-events: none;');
    expect(css).toContain('.aurvin-session-row:hover .aurvin-session-options');
    const scrollBtn = css.match(/\.aurvin-scroll-bottom\s*\{([^}]*)\}/)?.[1];
    expect(scrollBtn).toContain('flex-shrink: 0;');
    expect(scrollBtn).toContain('min-height: 36px;');
  });

  it('provides lean horizontal separator lines between text chat and voice chat sections', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const indicator = css.match(/\.aurvin-voice-chat-indicator\s*\{([^}]*)\}/)?.[1];
    expect(indicator).toContain('border-top: 1px solid var(--aurvin-border);');
    expect(indicator).toContain('border-bottom: 1px solid var(--aurvin-border);');
    expect(css).toContain('.aurvin-voice-chat-indicator + .aurvin-voice-chat-indicator');
  });

  it('hides scrollbars until their own scroll container is hovered', () => {
    const css = readFileSync(new URL('./scrollbars.css', import.meta.url), 'utf-8');
    expect(css).toContain('--aurvin-scrollbar-size:');
    expect(css).toContain('--aurvin-scrollbar-thumb:');
    expect(css).toContain('*::-webkit-scrollbar-thumb {');
    expect(css).toContain('scrollbar-width: thin;');
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    const hoverReveal = css.match(
      /@media\s*\(hover: hover\)[^{]*\{[\s\S]*?\[data-aurvin-scroll-reveal\]::-webkit-scrollbar-thumb,\s*\*:focus::-webkit-scrollbar-thumb\s*\{([^}]*)\}/,
    )?.[1];
    expect(hoverReveal).toContain('background-color: var(--aurvin-scrollbar-thumb);');
    const hidden = css.match(
      /@media\s*\(hover: hover\)[^{]*\{[\s\S]*?\*::-webkit-scrollbar-thumb\s*\{([^}]*)\}/,
    )?.[1];
    expect(hidden).toContain('background-color: transparent;');
    // Standard scrollbar properties stay Firefox-only so Chromium keeps the
    // custom ::-webkit-scrollbar pill instead of falling back to its native bar.
    expect(css).toContain('@supports (-moz-appearance: none)');
    // Chromium caches ::-webkit-scrollbar-thumb styles and will not re-resolve
    // them for a :hover change, so the reveal must not rely on :hover.
    // Focus must stay per-element: a focus-within match would pin a
    // container's scrollbar on after a button inside it was clicked.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toContain(':hover::-webkit-scrollbar-thumb');
    expect(rules).not.toContain(':focus-within');
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf-8');
    expect(main).toContain("import './styles/scrollbars.css'");
    expect(main).toContain('installScrollReveal()');
  });

  it('defines right-side prompt traveler rail, tick wave transitions, and popover window styles', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    expect(css).toContain('.aurvin-transcript-stage');
    expect(css).toContain('.aurvin-transcript-stage .aurvin-transcript');
    expect(css).toContain('scrollbar-width: none;');
    expect(css).toContain('.aurvin-prompt-traveler');
    expect(css).toContain('.aurvin-prompt-traveler-rail');
    expect(css).toContain('.aurvin-prompt-traveler-tick');
    expect(css).toContain('.aurvin-prompt-traveler-popover');
    expect(css).toContain('.aurvin-prompt-traveler-item');
    expect(css).toContain('--aurvin-prompt-travel-pad');
  });

  it('defines desktop 380px..50vw Canvas bounds, mobile sheet, 320ms right-slide keyframes, and reduced-motion override', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const panel = css.match(/\.aurvin-canvas-panel\s*\{([^}]*)\}/)?.[1];
    expect(panel).toContain('width: min(50vw, 680px);');
    expect(panel).toContain('min-width: 380px;');
    expect(panel).toContain('max-width: 50vw;');
    expect(css).toContain(".aurvin-canvas-panel[data-canvas-state='open']");
    expect(css).toContain(".aurvin-canvas-panel[data-canvas-state='exiting']");
    expect(css).toContain('320ms cubic-bezier(0.32, 0.72, 0, 1)');
    expect(css).toContain('@keyframes aurvin-canvas-slide-in');
    expect(css).toContain('@keyframes aurvin-canvas-slide-out');
    expect(css).toContain('translateX(100%)');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion: reduce\)[\s\S]*?\.aurvin-canvas-panel[\s\S]*?animation:\s*none;/,
    );
  });

  it('keeps Calendar scrolling/selectable with responsive focusable content instead of a diagram stage',()=>{
    const css=readFileSync(new URL('./chat.css',import.meta.url),'utf8');
    const body=css.match(/\.aurvin-canvas-calendar-body\s*\{([^}]+)\}/)![1];
    expect(body).toContain('overflow-y: auto');expect(body).toContain('user-select: text');expect(body).toContain('touch-action: pan-y');
    expect(body).not.toContain('transform:');expect(body).not.toContain('animation:');
    expect(css).toContain('.aurvin-calendar-workspace :is(button,a,summary):focus-visible');
    expect(css).toContain('@media (max-width: 600px)');
  });
});
