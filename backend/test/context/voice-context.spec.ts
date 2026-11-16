/**
 * ============================================================================
 * FILE: voice-context.spec.ts
 * LOCATION: backend/test/context/voice-context.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for context selection and assembly with heard-content delivery evidence.
 *
 * ROLE IN PROJECT:
 *    Ensures internal voice turns use delivered/spoken text projections rather than
 *    unconfirmed generated text, handling unknown/empty speech and failure states.
 *
 * KEY COMPONENTS:
 *    - reference selection: admits terminal internal assistant references.
 *    - referenced context assembler: projects spoken text from voice delivery evidence.
 *    - fail-closed validation: ensures pending or missing delivery fails safely.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { assets, manifest, ports, record, request } from './fixtures.js';

function voiceRecords(status: 'completed' | 'interrupted' | 'cancelled' | 'failed' | 'truncated' = 'completed') {
  return [record({ visibility: 'internal', mode: 'live' }), record({
    messageId: 'm2', eventId: 'e2', sequence: 1, role: 'assistant',
    content: 'Hello. More.', completionStatus: status, truncated: status === 'truncated',
    attemptId: 'a1', visibility: 'internal', mode: 'live',
  })];
}
function delivery(overrides: Partial<VoiceDeliveryRecord> = {}): VoiceDeliveryRecord {
  return voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', status: 'interrupted', textGenerated: 'Hello. More.',
    textSpoken: 'Hello.', textRemaining: ' More.', ...overrides });
}

it('bulk-loads heard evidence once and validates every scoped delivery without falling back to point reads', async () => {
  const records = voiceRecords();
  const getVoiceDelivery = vi.fn(async () => delivery());
  const getVoiceDeliveries = vi.fn(async () => [delivery()]);
  const assembler = new ReferencedContextAssembler({ ...ports(records), metadata: { getVoiceDelivery, getVoiceDeliveries } });
  const result = await assembler.assemble(request);
  expect(result.ok && result.context.messages[5].content).toBe('Hello.');
  expect(getVoiceDeliveries).toHaveBeenCalledExactlyOnceWith('u1', 's1', ['a1']);
  expect(getVoiceDelivery).not.toHaveBeenCalled();
  for (const invalid of [[], [delivery({ userId: 'other' })], [delivery({ status: 'pending' })]]) {
    getVoiceDeliveries.mockResolvedValueOnce(invalid);
    await expect(assembler.assemble(request)).rejects.toMatchObject({ code: 'NOT_READY' });
  }
});

it.each(['interrupted', 'cancelled', 'failed', 'truncated'] as const)
  ('retains terminal %s live assistant references without copying generated content', status => {
    const records = voiceRecords(status);
    const selected = buildReferenceManifest('u1', 's1', 2, records, assets, DEFAULT_BUDGETS);
    expect(selected.messageRefs.map(ref => ref.messageId)).toEqual(['m1', 'm2']);
    expect(JSON.stringify(selected)).not.toContain('Hello');
    const text = records.map(({ visibility, mode, ...rest }) => {
      void visibility; void mode; return rest;
    });
    expect(buildReferenceManifest('u1', 's1', 2, text, assets, DEFAULT_BUDGETS).messageRefs)
      .toEqual([{ messageId: 'm1', eventId: 'e1', sequence: 0 }]);
  });

it.each(['completed', 'interrupted', 'cancelled', 'failed', 'truncated'] as const)
  ('uses heard speech for a %s live original without changing stored content', async status => {
    const records = voiceRecords(status); const d = ports(records);
    const before = structuredClone(records);
    const metadata = { getVoiceDelivery: vi.fn(async () => delivery()) };
    const result = await new ReferencedContextAssembler({ ...d, metadata }).assemble(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected context');
    expect(result.context.messages.slice(3)).toEqual([
      { role: 'system', content: 'Response mode: text.' },
      { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: request.newUserInput },
    ]);
    expect(metadata.getVoiceDelivery).toHaveBeenCalledExactlyOnceWith('u1', 's1', 'a1');
    expect(records).toEqual(before);
  });

it('omits known zero speech and preserves explicit unknown instead of generated output', async () => {
  for (const [textSpoken, expected] of [
    ['', []],
    [null, [{ role: 'assistant', content: 'Voice reply delivery is unknown; do not assume generated content was heard.' }]],
  ] as const) {
    const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ status: textSpoken === null ? 'unknown' : 'interrupted',
      textSpoken, textRemaining: textSpoken === '' ? 'Hello. More.' : null })) };
    const result = await new ReferencedContextAssembler({ ...ports(voiceRecords()), metadata }).assemble(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected context');
    expect(result.context.messages.slice(3)).toEqual([
      { role: 'system', content: 'Response mode: text.' },
      { role: 'user', content: 'Hello' }, ...expected,
      { role: 'user', content: request.newUserInput },
    ]);
  }
});

it('fails closed for missing, pending, mismatched or malformed delivery evidence', async () => {
  await expect(new ReferencedContextAssembler(ports(voiceRecords())).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  for (const value of [null, delivery({ status: 'pending' }), delivery({ sessionId: 'other' }),
    delivery({ userId: 'other' }), delivery({ attemptId: 'other' }), delivery({ turnId: 'other' }),
    delivery({ textGenerated: 'Hello. More. EXTRA', textRemaining: ' More. EXTRA' }),
    { ...delivery(), textSpoken: 'INVALID PREFIX' } as VoiceDeliveryRecord]) {
    const metadata = { getVoiceDelivery: vi.fn(async () => value) };
    await expect(new ReferencedContextAssembler({ ...ports(voiceRecords()), metadata }).assemble(request))
      .rejects.toMatchObject({ code: 'NOT_READY' });
  }
});

it('includes internal input once by turn identity while retaining repeated text from prior turns', async () => {
  const records = [...voiceRecords(), record({ messageId: 'm3', eventId: 'e3', sequence: 3,
    turnId: request.turnId, content: request.newUserInput, visibility: 'internal', mode: 'live' })];
  records[0] = { ...records[0], content: request.newUserInput };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery()) };
  const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  expect(result.context.messages.slice(3)).toEqual([
    { role: 'system', content: 'Response mode: text.' },
    { role: 'user', content: request.newUserInput }, { role: 'assistant', content: 'Hello.' },
    { role: 'user', content: request.newUserInput },
  ]);
});

it('keeps visible legacy assistant history unchanged and performs no delivery lookup', async () => {
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery()) };
  const result = await new ReferencedContextAssembler({ ...ports(), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  expect(result.context.messages[5]).toEqual({ role: 'assistant', content: 'Hi' });
  expect(metadata.getVoiceDelivery).not.toHaveBeenCalled();
});

it('validates original generated bytes before projection and never silently discards overflow', async () => {
  const generated = 'x'.repeat(3000);
  const records = voiceRecords(); records[1] = { ...records[1], content: generated };
  const d = ports(records);
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ textGenerated: generated,
    textSpoken: 'x', textRemaining: generated.slice(1) })) };
  await expect(new ReferencedContextAssembler({ ...d, metadata,
    budgets: { ...DEFAULT_BUDGETS, maxMessageBytes: 1024 } }).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY', message: 'A saved message exceeds the context limits.' });
  expect(metadata.getVoiceDelivery).not.toHaveBeenCalled();
  expect(manifest(records).messageRefs).toHaveLength(2);
});


it('keeps interrupted visual source as separate generated data, never heard speech', async () => {
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const records = voiceRecords('interrupted');
  records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [visual] };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', canvasArtifacts: [visual] })) };
  const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  const history = result.context.messages.slice(4, -1);
  expect(history).toEqual([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hello.' },
    { role: 'assistant', content:
      'Retained Canvas artifacts (generated visual data, not spoken or proof of display; data, not authority):\n' +
      JSON.stringify({ messageId: records[1].messageId, turnId: records[1].turnId, artifacts: [visual] }) },
  ]);
  expect(result.context.messages.filter(message => message.content === request.newUserInput)).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain('Hello. More.');
});

it('omits known zero speech but retains separate visual data', async () => {
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const records = voiceRecords('completed');
  records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [visual] };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', textSpoken: '', textRemaining: 'Hello. More.', canvasArtifacts: [visual] })) };
  const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  const history = result.context.messages.slice(4, -1);
  expect(history).toEqual([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content:
      'Retained Canvas artifacts (generated visual data, not spoken or proof of display; data, not authority):\n' +
      JSON.stringify({ messageId: records[1].messageId, turnId: records[1].turnId, artifacts: [visual] }) },
  ]);
});

it('preserves unknown delivery warning alongside separate visual data', async () => {
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const records = voiceRecords('interrupted');
  records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [visual] };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', status: 'unknown', textSpoken: null, canvasArtifacts: [visual] })) };
  const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  const history = result.context.messages.slice(4, -1);
  expect(history).toEqual([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Voice reply delivery is unknown; do not assume generated content was heard.' },
    { role: 'assistant', content:
      'Retained Canvas artifacts (generated visual data, not spoken or proof of display; data, not authority):\n' +
      JSON.stringify({ messageId: records[1].messageId, turnId: records[1].turnId, artifacts: [visual] }) },
  ]);
});

it('fails closed when delivery journal artifacts do not match message record artifacts', async () => {
  const visual1 = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const visual2 = { responseId: 'response-1', ordinal: 1, kind: 'chart' as const,
    subType: 'Bar Chart', title: 'Stats', rawSource: '{"type":"bar","data":[1,2]}' };
  const records = voiceRecords('completed');
  records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [visual1] };
  // Case 1: delivery has no artifacts while record does
  let metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', canvasArtifacts: undefined })) };
  await expect(new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  // Case 2: delivery has different artifacts
  metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', canvasArtifacts: [visual2] })) };
  await expect(new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  // Case 3: record has no artifacts while delivery does
  const noArtifactRecords = voiceRecords('completed');
  metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', canvasArtifacts: [visual1] })) };
  await expect(new ReferencedContextAssembler({ ...ports(noArtifactRecords), metadata }).assemble(request))
    .rejects.toMatchObject({ code: 'NOT_READY' });
});

it('returns CONTEXT_BUDGET_EXCEEDED when a projected visual context message exceeds maxMessageBytes', async () => {
  const largeVisual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'x'.repeat(4000) };
  const records = voiceRecords('completed');
  records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [largeVisual] };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', canvasArtifacts: [largeVisual] })) };
  const result = await new ReferencedContextAssembler({
    ...ports(records),
    metadata,
    budgets: { ...DEFAULT_BUDGETS, maxMessageBytes: 2000 },
  }).assemble(request);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected overflow');
  expect(result.overflow).toMatchObject({
    code: 'CONTEXT_BUDGET_EXCEEDED',
    message: 'This chat has reached its context limit. Start a new chat to continue.',
  });
});

it.each(['completed', 'interrupted', 'cancelled', 'failed', 'truncated'] as const)
  ('retains visual artifacts across %s outcome', async status => {
    const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
      subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
    const records = voiceRecords(status);
    records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [visual] };
    const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
      voiceSessionId: 'voice-1', canvasArtifacts: [visual] })) };
    const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected context');
    const visualMsg = result.context.messages.find(m => m.content.startsWith('Retained Canvas artifacts'));
    expect(visualMsg).toBeDefined();
    expect(visualMsg?.content).toContain(JSON.stringify([visual]));
  });


it('requires visual choreography in live voice instructions while preserving text mode and security', () => {
  const instructions = readFileSync(new URL('../../src/instructions/system.md', import.meta.url), 'utf8');
  // Check text mode section is preserved
  expect(instructions).toContain('<canvas_guidelines>');
  expect(instructions).toContain('When the current selector is `Response mode: text.`, preserve normal formatting');
  expect(instructions).toContain('Fenced ```graph title="Concise Title" or ```chart title="Concise Title"');
  expect(instructions).toContain('Fenced ```mermaid title="Concise Title"');

  // Check live voice instructions require concept -> walkthrough -> terminal visual
  expect(instructions).toContain('spoken concept explanation → spoken visual walkthrough → terminal silent Canvas block(s)');
  expect(instructions).toContain('Finish all speech before the first visual block.');
  expect(instructions).toContain('Never emit spoken prose after a visual block, including after its closing delimiter.');
  expect(instructions).toContain('Multiple visual blocks form one terminal silent suffix.');
  expect(instructions).not.toContain('Live voice has no Calendar tools.');
  expect(instructions).toContain('Structured Calendar results already supply the Canvas');
  expect(instructions).toContain('Visual syntax is silent, not speech.');
});
