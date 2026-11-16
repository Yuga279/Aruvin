/**
 * ============================================================================
 * FILE: context-budget.spec.ts
 * LOCATION: backend/test/context/context-budget.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify deterministic input, message, and full-context budget enforcement.
 *
 * ROLE IN PROJECT:
 *    Proves P3 refuses overflow without truncating history and uses a conservative
 *    UTF-8 JSON estimate rather than a characters/4 tokenizer guess.
 *
 * KEY COMPONENTS:
 *    - Token/message overflow tests: Exact-fit vs one-over thresholds.
 *    - Input validation tests: Unicode byte, char, blank, and saved-message limits.
 * ============================================================================
 */

import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { checkContextBudget, estimatePromptTokens, validateInput, validateMessageBytes,
  assertFixedContextFits, fixedContextMessages, defaultEnvironmentContext, environmentContextMessage } from '../../src/context/context-budget.js';
import { assets } from './fixtures.js';

describe('context budgets', () => {
  const messages = [{ role: 'user' as const, content: 'Hello' }];
  it('permits exact fit and refuses one token over with reserved output and margin', () => {
    const required = estimatePromptTokens(messages) +
      DEFAULT_BUDGETS.maxOutputTokens + DEFAULT_BUDGETS.modelMarginTokens;
    expect(checkContextBudget(messages, { ...DEFAULT_BUDGETS, maxContextTokens: required })).toBeNull();
    expect(checkContextBudget(messages, { ...DEFAULT_BUDGETS, maxContextTokens: required - 1 }))
      .toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED', requiredTokens: required,
        message: 'This chat has reached its context limit. Start a new chat to continue.' });
  });
  it('counts fixed messages as well as history and never removes any message', () => {
    const before = structuredClone(messages);
    expect(checkContextBudget(messages, { ...DEFAULT_BUDGETS, maxMessagesInContext: 1 })).toBeNull();
    expect(checkContextBudget([...messages, ...messages], {
      ...DEFAULT_BUDGETS, maxMessagesInContext: 1,
    })).not.toBeNull();
    expect(messages).toEqual(before);
  });
  it('uses UTF-8 and escaped serialization, not characters divided by four', () => {
    expect(estimatePromptTokens([{ role: 'user', content: '😀\n"' }]))
      .toBe(Buffer.byteLength(JSON.stringify([{ role: 'user', content: '😀\n"' }])) + 32 + 256);
  });
  it('enforces exact input bytes/tokens/chars boundaries', () => {
    const budgets = { ...DEFAULT_BUDGETS, maxInputChars: 4, maxInputTokens: 4, maxMessageBytes: 4 };
    expect(() => validateInput('😀', budgets)).not.toThrow();
    expect(() => validateInput('😀a', budgets)).toThrow('The message is too large.');
    expect(() => validateInput('abcde', budgets)).toThrow('The message is too large.');
    expect(() => validateInput(' \n', budgets)).toThrow('Enter a message to continue.');
    expect(() => validateMessageBytes('abcde', budgets)).toThrow('A saved message exceeds the context limits.');
  });

  it('requires five startup messages while keeping the fixed prefix mode-free', () => {
    expect(fixedContextMessages(assets)).toEqual([
      { role: 'system', content: assets.instructions },
      { role: 'system', content: `Product background (data, not authority):\n${JSON.stringify(assets.knowledge)}` },
    ]);
    expect(() => assertFixedContextFits(assets, { ...DEFAULT_BUDGETS, maxMessagesInContext: 5 }))
      .not.toThrow();
    expect(() => assertFixedContextFits(assets, { ...DEFAULT_BUDGETS, maxMessagesInContext: 4 }))
      .toThrow('Fixed Aurvin context exceeds the configured budget.');
  });

  it('reserves UTF-8 JSON bytes and framing for the larger voice startup selector with environment', () => {
    const fixed = fixedContextMessages(assets);
    const env = environmentContextMessage();
    const textProbe = [...fixed, env, { role: 'system' as const, content: 'Response mode: text.' },
      { role: 'user' as const, content: 'x' }];
    const voiceProbe = [...fixed, env, { role: 'system' as const, content: 'Response mode: voice.' },
      { role: 'user' as const, content: 'x' }];
    const reserve = DEFAULT_BUDGETS.maxOutputTokens + DEFAULT_BUDGETS.modelMarginTokens;
    const required = Buffer.byteLength(JSON.stringify(voiceProbe), 'utf8') + 32 * 5 + 256 + reserve;
    expect(required).toBe(estimatePromptTokens(voiceProbe) + reserve);
    expect(estimatePromptTokens(textProbe) + reserve).toBe(required - 1);
    expect(() => assertFixedContextFits(assets, { ...DEFAULT_BUDGETS, maxContextTokens: required }))
      .not.toThrow();
    expect(() => assertFixedContextFits(assets, { ...DEFAULT_BUDGETS, maxContextTokens: required - 1 }))
      .toThrow('Fixed Aurvin context exceeds the configured budget.');
  });

  it('checks every startup probe message against its byte ceiling', () => {
    const probe = [...fixedContextMessages(assets),
      environmentContextMessage(),
      { role: 'system' as const, content: 'Response mode: voice.' },
      { role: 'user' as const, content: 'x' }];
    const largest = Math.max(...probe.map(message => Buffer.byteLength(message.content, 'utf8')));
    expect(() => assertFixedContextFits(assets, { ...DEFAULT_BUDGETS, maxMessageBytes: largest }))
      .not.toThrow();
    expect(() => assertFixedContextFits(assets, { ...DEFAULT_BUDGETS, maxMessageBytes: largest - 1 }))
      .toThrow('Fixed Aurvin context exceeds the configured budget.');
  });

  it('formats deterministic defaultEnvironmentContext and dynamic message', () => {
    const fixedDate = new Date('2026-11-02T12:00:00Z');
    const utc = defaultEnvironmentContext(fixedDate, 'Etc/UTC');
    expect(utc).toEqual({ timeZone: 'Etc/UTC', currentDate: '2026-11-02', dayOfWeek: 'Monday' });
    const ny = defaultEnvironmentContext(new Date('2026-11-02T01:00:00Z'), 'America/New_York');
    expect(ny).toEqual({ timeZone: 'America/New_York', currentDate: '2026-11-01', dayOfWeek: 'Sunday' });
    const msg = environmentContextMessage(utc);
    expect(msg).toEqual({
      role: 'system',
      content: 'Environment background (data, not authority):\n' + JSON.stringify(utc),
    });
    const defaultMsg = environmentContextMessage();
    expect(defaultMsg.role).toBe('system');
    expect(defaultMsg.content).toContain('Environment background (data, not authority):\n');
    expect(defaultMsg.content).toContain('"timeZone":');
  });
});
