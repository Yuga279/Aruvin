/**
 * ============================================================================
 * FILE: canvas-multimodal.spec.ts
 * LOCATION: backend/test/voice/integration/canvas-multimodal.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integrated voice Canvas multimodal test suite verifying boundary filtering,
 *    live pipeline relay, interruption semantics, CAS durability, and context recovery.
 *
 * ROLE IN PROJECT:
 *    Primary verification spec for P3 objective voice-canvas-multimodal, covering
 *    filter boundaries, runtime relay, failure recovery, timing traces, and context integrity.
 *
 * KEY COMPONENTS:
 *    - Canvas multimodal boundaries: Exhaustive chunk split and cut verification across visual formats
 *    - Delimiter adversaries: Malformed, truncated, oversized, hidden, and overflowing streams
 * ============================================================================
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeechProse } from '../../../src/voice/agent/speech-prose.js';
import type { CanvasArtifactSource } from '../../../src/contracts/voice-wire.js';
import { CANVAS_ARTIFACT_LIMITS } from '../../../src/contracts/voice-wire.js';
import { AppError } from '../../../src/platform/errors/app-error.js';
import { VISUALS, SPEECH, TRAILING, sourceOf, block, partitions }
  from '../../../../frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.js';
import { canvasPipeline } from './canvas-multimodal-fixture.js';
import { collectSessionCanvasArtifacts, mergeSessionCanvasArtifacts, projectionToCanvasArtifact }
  from '../../../../frontend/src/features/canvas/canvas-artifacts.js';

import { graphConfig } from '../../../src/chat-runtime/finalization.js';
import { key } from '../../../src/persistence/records.js';
import { parseVoiceControl } from '../../../src/contracts/voice-wire.js';
import { settle } from '../../../../frontend/src/features/voice/state/testing/live-voice-fixture.ts';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function filtered(chunks: string[]) {
  const artifacts: CanvasArtifactSource[] = [];
  const filter = new SpeechProse(32000, a => artifacts.push(a));
  return { speech: chunks.map(c => filter.push(c)).join('') + filter.finish(), artifacts };
}

describe('Canvas multimodal boundaries', () => {
  it.each(VISUALS)('silences every cut for $subType', item => {
    for (const frame of ['ticks', 'tildes', 'tag'] as const) {
      const raw = `${SPEECH}\n${block(item, frame)}${TRAILING}`;
      for (const chunks of partitions(raw)) {
        expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [sourceOf(item)] });
      }
    }
  });

  it('drops partial, malformed, hidden and oversized candidates with stable ordinal gaps', () => {
    const flow = VISUALS[0]!;
    const invalid = [
      '```mermaid\nflowchart TD\nA -->',
      '~~~chart\n{"type":"bar","data":[',
      '<aurvin-canvas type="svg"><svg><rect /></svg>',
      '```chart\n{"type":"bar","data":[}\n```\n',
      '```mermaid\n\n```\n',
      `\`\`\`mermaid\nflowchart TD\nA[${'x'.repeat(8193)}] --> B\n\`\`\`\n`,
      `\`\`\`mermaid\nflowchart TD\nA[${'界'.repeat(6000)}] --> B\n\`\`\`\n`,
      '<aurvin-canvas type="svg" type="chart"><svg><rect /></svg></aurvin-canvas>\n',
      '<aurvin-canvas type="svg"><aurvin-canvas type="svg"><svg><rect /></svg></aurvin-canvas></aurvin-canvas>\n',
    ];
    for (const bad of invalid) for (const chunks of partitions(`${SPEECH}\n${bad}`)) {
      expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    }
    const hidden = `<think>${block(flow, 'ticks')}</think>${SPEECH}`;
    for (const chunks of partitions(hidden)) expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    const gap = `\`\`\`mermaid\n\n\`\`\`\n${block(flow, 'ticks')}${TRAILING}`;
    expect(filtered([`${SPEECH}\n${gap}`])).toEqual({ speech: SPEECH,
      artifacts: [{ ...sourceOf(flow), ordinal: 1 }] });
    const four = filtered([`${SPEECH}\n${block(flow, 'ticks').repeat(4)}${TRAILING}`]);
    expect(four.speech).toBe(SPEECH);
    expect(four.artifacts.map(a => a.ordinal)).toEqual([0, 1, 2]);
  });

  it('handles concrete delimiter adversaries, latches silence, and bounds buffer growth', () => {
    const flow = VISUALS[0]!;

    // 1. Opener/header/closing run/tag truncated at each code-unit position
    const sampleTag = `<aurvin-canvas type="svg" title="${flow.title}">\n<svg><rect /></svg>\n</aurvin-canvas>\n`;
    for (let cut = 1; cut < 25; cut++) {
      const truncatedOpener = `${SPEECH}\n${sampleTag.slice(0, cut)}`;
      for (const chunks of partitions(truncatedOpener)) {
        expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
      }
    }
    const sampleFence = `\`\`\`mermaid title="${flow.title}"\nflowchart TD\nA --> B\n\`\`\`\n`;
    for (let cut = 1; cut < 15; cut++) {
      const truncatedFence = `${SPEECH}\n${sampleFence.slice(0, cut)}`;
      for (const chunks of partitions(truncatedFence)) {
        expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
      }
    }

    // 2. 4-backtick opener with a 3-backtick non-close
    const fourTickBadClose = `${SPEECH}\n\`\`\`\`mermaid title="${flow.title}"\nflowchart TD\nA --> B\n\`\`\`\n${TRAILING}`;
    for (const chunks of partitions(fourTickBadClose)) {
      expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    }

    // 3. Wrong-character close: ticks opened, tildes closed
    const wrongCharClose = `${SPEECH}\n\`\`\`mermaid title="${flow.title}"\nflowchart TD\nA --> B\n~~~\n${TRAILING}`;
    for (const chunks of partitions(wrongCharClose)) {
      expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    }

    // 4. Delimiter inside a JSON string
    const jsonWithDelim = `~~~chart title="Chart With Delimiter"\n{"type":"bar","labels":["~~~","\`\`\`"],"datasets":[{"label":"Count","data":[1]}]}\n~~~\n${TRAILING}`;
    for (const chunks of partitions(`${SPEECH}\n${jsonWithDelim}`)) {
      const result = filtered(chunks);
      expect(result.speech).toBe(SPEECH);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.kind).toBe('chart');
    }

    // 5. CRLF and Unicode/split surrogate pairs
    const crlfRaw = `${SPEECH}\r\n\`\`\`mermaid title="CRLF Diagram 😀"\r\nflowchart TD\r\nA[Start 😀] --> B[Finish 界]\r\n\`\`\`\r\n${TRAILING}`;
    for (const chunks of partitions(crlfRaw)) {
      const res = filtered(chunks);
      expect(res.speech).toBe(SPEECH);
      expect(res.artifacts).toHaveLength(1);
      expect(res.artifacts[0]!.rawSource).toContain('😀');
      expect(res.artifacts[0]!.rawSource).toContain('界');
    }

    // 6. 513-char and 1025-byte headers on aurvin-canvas
    const longHeaderChar = `<aurvin-canvas type="svg" title="${'x'.repeat(513)}">\n<svg><rect /></svg>\n</aurvin-canvas>\n`;
    expect(filtered([`${SPEECH}\n${longHeaderChar}${TRAILING}`])).toEqual({ speech: SPEECH, artifacts: [] });
    const longHeaderByte = `<aurvin-canvas type="svg" title="${'界'.repeat(350)}">\n<svg><rect /></svg>\n</aurvin-canvas>\n`;
    expect(filtered([`${SPEECH}\n${longHeaderByte}${TRAILING}`])).toEqual({ speech: SPEECH, artifacts: [] });

    // 7. Raw JSON / hidden tags / unsupported JavaScript: unsupported-only silent code may still be followed by safe prose
    const rawJson = `${SPEECH}\n{"randomKey": "randomValue", "nested": [1, 2, 3]}\nFollow-up prose.`;
    for (const chunks of partitions(rawJson)) {
      const res = filtered(chunks);
      expect(res.speech).toBe(`${SPEECH} Follow-up prose.`);
      expect(res.artifacts).toEqual([]);
    }
    const hiddenTag = `${SPEECH}\n<think>some reasoning</think>\nFollow-up prose.`;
    for (const chunks of partitions(hiddenTag)) {
      const res = filtered(chunks);
      expect(res.speech).toBe(`${SPEECH} Follow-up prose.`);
      expect(res.artifacts).toEqual([]);
    }
    const jsCode = `${SPEECH}\n\`\`\`javascript\nconsole.log("unsupported");\n\`\`\`\nMore spoken words.`;
    const jsResult = filtered([jsCode]);
    expect(jsResult.speech).toBe(`${SPEECH} More spoken words.`);
    expect(jsResult.artifacts).toEqual([]);

    // 8. Missing source metadata / empty body
    const emptyMermaid = `${SPEECH}\n\`\`\`mermaid\n\`\`\`\n`;
    expect(filtered([emptyMermaid])).toEqual({ speech: SPEECH, artifacts: [] });

    // 9. Supported candidate latches silence permanently even if rejected
    const rejectedMermaid = `${SPEECH}\n\`\`\`mermaid\ninvalid syntax not matching mermaid header\n\`\`\`\n${TRAILING}`;
    for (const chunks of partitions(rejectedMermaid)) {
      expect(filtered(chunks)).toEqual({ speech: SPEECH, artifacts: [] });
    }

    // 10. Supported suffix followed by unsupported code and trailing prose
    const multiBlock = `${SPEECH}\n${block(flow, 'ticks')}\`\`\`python\nprint(1)\n\`\`\`\n${TRAILING}`;
    const multiRes = filtered([multiBlock]);
    expect(multiRes.speech).toBe(SPEECH);
    expect(multiRes.artifacts).toHaveLength(1);

    // 11. Bounded raw-answer overflow assertion that throws rather than growing buffers
    const hugeChunk = 'a'.repeat(32001);
    expect(() => filtered([hugeChunk])).toThrow(AppError);
    expect(() => filtered([hugeChunk])).toThrowError(/exceeded its speech limit/i);
  });
});

describe('Real offline Canvas pipeline', () => {
  it('uses the assembled LiveKit Room bridge rather than a live PCM socket', async () => {
    vi.useFakeTimers();
    const f = await canvasPipeline();
    try {
      expect(f).toHaveProperty('media');
      expect(f).toHaveProperty('epoch');
      expect(f).not.toHaveProperty('connection');
      expect(f).not.toHaveProperty('server');
    } finally { await f.close(); }
  });

  it.each(VISUALS)('real pipeline keeps $subType silent and linked before provider EOF', async item => {
    vi.useFakeTimers();
    const f = await canvasPipeline();
    try {
      await f.begin();
      for (const piece of `${SPEECH}\n${block(item, 'ticks')}`.split('')) await f.push(piece);
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
      expect(f.events.some(e => e.type === 'audio.start')).toBe(false);
      const event = f.events.find(e => e.type === 'canvas.artifact')!;
      const journal = await f.delivery();
      expect(journal?.canvasArtifacts).toEqual(f.ui.controller.getSnapshot().artifacts);
      expect(f.trace.indexOf('artifact-committed')).toBeLessThan(f.trace.indexOf('artifact-sent'));
      expect(projectionToCanvasArtifact(journal!.canvasArtifacts![0]!)?.rawSource).toBe(item.rawSource);
      expect(vi.mocked(f.tts.connection.speak).mock.calls.map(([c]) => c.text).join('')).toBe(SPEECH);
      expect(event.type).toBe('canvas.artifact');
      await f.push(TRAILING); await f.endModel(); await f.finishAudio();
      const rows = await f.messages();
      const assistant = rows.filter(m => m.role === 'assistant');
      expect(assistant).toHaveLength(1);
      expect(assistant[0]!.content).toBe(SPEECH);
      expect(assistant[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
      expect((await f.delivery())!.textGenerated).toBe(SPEECH);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(f.h.fetcher.mock.calls[0]![1]!.body)).user).toBe(f.h.identity.openRouterUser);
    } finally { await f.close(); }
  }, 30000);

  it.each(['tildes', 'tag'] as const)('real pipeline supports %s framing', async frame => {
    vi.useFakeTimers();
    const f = await canvasPipeline();
    try {
      await f.begin();
      for (const piece of `${SPEECH}\n${block(VISUALS[0]!, frame)}`.split('')) await f.push(piece);
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
      const journal = await f.delivery();
      expect(journal?.canvasArtifacts).toEqual(f.ui.controller.getSnapshot().artifacts);
      expect(projectionToCanvasArtifact(journal!.canvasArtifacts![0]!)?.rawSource).toBe(VISUALS[0]!.rawSource);
      await f.push(TRAILING); await f.endModel(); await f.finishAudio();
      const rows = await f.messages();
      const assistant = rows.filter(m => m.role === 'assistant');
      expect(assistant).toHaveLength(1);
      expect(assistant[0]!.canvasArtifacts).toEqual(journal!.canvasArtifacts);
    } finally { await f.close(); }
  }, 30000);

  it('handles ordinal gaps, multiple complete artifacts, and fourth candidate rejection in real pipeline', async () => {
    vi.useFakeTimers();
    const f = await canvasPipeline();
    try {
      await f.begin();
      const input = `${SPEECH}\n\`\`\`mermaid\n\n\`\`\`\n${block(VISUALS[0]!, 'ticks')}${block(VISUALS[1]!, 'ticks')}${block(VISUALS[2]!, 'ticks')}`;
      for (const line of input.split('\n')) await f.push(line + '\n');
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 2);
      const journal = await f.delivery();
      expect(journal?.canvasArtifacts).toHaveLength(2);
      expect(journal?.canvasArtifacts?.map(a => a.ordinal)).toEqual([1, 2]);
      expect(f.ui.controller.getSnapshot().artifacts.map(a => a.ordinal)).toEqual([1, 2]);
      await f.push(TRAILING); await f.endModel(); await f.finishAudio();
      const assistant = (await f.messages()).filter(m => m.role === 'assistant');
      expect(assistant).toHaveLength(1);
      expect(assistant[0]!.canvasArtifacts?.map(a => a.ordinal)).toEqual([1, 2]);
    } finally { await f.close(); }
  }, 30000);

  it('enforces wire guards, direction restrictions, and 131072-byte control caps', () => {
    const valid = {
      protocolVersion: 1 as const,
      sessionId: 'voice-session-1',
      connectionEpoch: 1,
      eventId: 'evt-1',
      sequence: 1,
      type: 'canvas.artifact' as const,
      turnId: 'turn-1',
      responseId: 'resp-1',
      ordinal: 0,
      kind: 'mermaid' as const,
      subType: 'Flowchart',
      title: 'Valid Diagram',
      rawSource: 'flowchart TD\nA --> B',
    };
    const json = JSON.stringify(valid);
    expect(parseVoiceControl(json, 'server', 'live')).toEqual(valid);
    expect(() => parseVoiceControl(json, 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(json, 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');

    const currentBytes = new TextEncoder().encode(json).byteLength;
    const padding = ' '.repeat(131072 - currentBytes);
    expect(parseVoiceControl(json + padding, 'server', 'live')).toEqual(valid);
    expect(() => parseVoiceControl(json + padding + ' ', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
  });
});

describe('Interrupt and fault matrix', () => {
  it.each(['before', 'during', 'after'] as const)('interrupt %s visual keeps only confirmed complete source', async phase => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    try {
      await f.begin(); await f.push(`${SPEECH}\n`);
      const framed = block(VISUALS[0]!, 'ticks');
      if (phase === 'during') await f.push(framed.slice(0, -5));
      if (phase === 'after') {
        await f.push(framed);
        await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
      }
      const retained = structuredClone(f.ui.controller.getSnapshot().artifacts);
      f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'barge-in-2' });
      await f.tick(2500);
      await f.until(() => f.bridge().currentResponse() === null);
      expect(f.ui.controller.getSnapshot().artifacts).toEqual(retained);
      expect(retained).toHaveLength(phase === 'after' ? 1 : 0);
      const s = f.binding.response.conversationId!;
      await f.h.runtime.reconcileSession(f.h.identity.userId, s);
      await f.h.runtime.reconcileSession(f.h.identity.userId, s);
      const assistants = (await f.messages()).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]?.canvasArtifacts ?? []).toEqual(retained);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
      expect(f.ui.controller.getSnapshot().errorCode).not.toBe('VOICE_INVALID_STATE');
    } finally { await f.close(); }
  }, 30000);

  it('interrupt during artifact CAS keeps confirmed evidence but emits no late visual', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    let release!: () => void, entered = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let blocked: { mockRestore(): void } | undefined;
    try {
      await f.begin(); await f.push(`${SPEECH}\n`);
      const compare = f.h.p.metadata.compareVoiceDelivery.bind(f.h.p.metadata);
      blocked = vi.spyOn(f.h.p.metadata, 'compareVoiceDelivery').mockImplementation(async (record, n) => {
        if (record.canvasArtifacts?.length && !entered) { entered = true; await gate; }
        return compare(record, n);
      });
      const writing = f.push(block(VISUALS[0]!, 'ticks'));
      await f.until(() => entered);
      f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'interrupt-during-cas' });
      f.microphone();
      await f.until(() => vi.mocked(f.stt.connection.writeAudio).mock.calls.length === 1);
      expect(f.events.filter(e => e.type === 'canvas.artifact')).toEqual([]);
      release(); await writing; await f.tick(2500);
      await f.until(() => f.bridge().currentResponse() === null);
      const s = f.binding.response.conversationId!;
      await f.h.runtime.reconcileSession(f.h.identity.userId, s);
      const assistants = (await f.messages()).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]!.canvasArtifacts).toEqual((await f.delivery())!.canvasArtifacts);
      expect(assistants[0]!.canvasArtifacts).toHaveLength(1);
      expect(f.events.filter(e => e.type === 'canvas.artifact')).toEqual([]);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    } finally { release(); blocked?.mockRestore(); await f.close(); }
  }, 30000);

  it('journal CAS rejection emits zero artifact events and leaves terminal evidence', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    let blocked: { mockRestore(): void } | undefined;
    try {
      await f.begin();
      blocked = vi.spyOn(f.h.p.metadata, 'compareVoiceDelivery').mockImplementation(async (record, n) => {
        if (record.canvasArtifacts?.length) return false;
        return true;
      });
      await f.push(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`);
      await f.tick(2500);
      expect(f.events.filter(e => e.type === 'canvas.artifact')).toEqual([]);
      expect(f.ui.controller.getSnapshot().artifacts).toEqual([]);
      const del = await f.delivery();
      expect(del?.canvasArtifacts ?? []).toEqual([]);
    } finally { blocked?.mockRestore(); await f.close(); }
  }, 30000);

  it('server send failure after confirmed CAS preserves source in assistant without re-inference', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    try {
      await f.begin();
      const origSend = f.sendControl.getMockImplementation()!;
      f.sendControl.mockImplementation(event => {
        if (event.type === 'canvas.artifact') throw new Error('fixture control publish failure');
        origSend(event);
      });
      await f.push(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`);
      await f.tick(2000);
      const s = f.binding.response.conversationId!;
      await f.h.runtime.reconcileSession(f.h.identity.userId, s);
      await f.h.runtime.reconcileSession(f.h.identity.userId, s);
      const assistants = (await f.messages()).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]!.canvasArtifacts).toHaveLength(1);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  }, 30000);

  it('sealed result publication failure recovers deterministic assistant without re-inference', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    let appendFail: { mockRestore(): void } | undefined;
    let shouldFail = true;
    try {
      await f.begin();
      await f.audio();
      const origAppend = f.h.p.messages.append.bind(f.h.p.messages);
      appendFail = vi.spyOn(f.h.p.messages, 'append').mockImplementation(async row => {
        if (shouldFail && row.role === 'assistant') {
          shouldFail = false;
          throw new Error('simulated assistant append failure');
        }
        return origAppend(row);
      });
      await f.push(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`);
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
      try {
        await f.endModel();
        await f.tick(3000);
      } catch {
        // Expected publication failure
      }

      const conversationId = f.binding.response.conversationId!;
      const graph = await f.h.runtime.graph({ userId: f.h.identity.userId, sessionId: conversationId,
        ownerId: 'canvas-fixture-inspect', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
      const saved = await graph.getState(graphConfig(f.h.identity.userId, conversationId));
      expect(saved.values.sealed).toBe(true);
      expect(saved.values.result.assistant.canvasArtifacts).toEqual((await f.delivery())!.canvasArtifacts);

      shouldFail = false;
      appendFail.mockRestore(); appendFail = undefined;
      await f.h.restart();
      await f.h.runtime.reconcileSession(f.h.identity.userId, conversationId);
      await f.h.runtime.reconcileSession(f.h.identity.userId, conversationId);

      const assistants = (await f.messages()).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]!.canvasArtifacts).toEqual((await f.delivery())!.canvasArtifacts);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    } finally { appendFail?.mockRestore(); await f.close(); }
  }, 30000);

  it('second crash location gating memory.put recovers confirmed artifact', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    let memFail: { mockRestore(): void } | undefined;
    try {
      await f.begin();
      let putCount = 0;
      const origPut = f.h.p.memory.put.bind(f.h.p.memory);
      memFail = vi.spyOn(f.h.p.memory, 'put').mockImplementation(async doc => {
        if (++putCount > 1) throw new Error('simulated manifest write failure');
        return origPut(doc);
      });
      await f.push(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`);
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
      await f.endModel();
      await f.finishAudio();

      const conversationId = f.binding.response.conversationId!;
      memFail.mockRestore(); memFail = undefined;
      await f.h.restart();
      await f.h.runtime.reconcileSession(f.h.identity.userId, conversationId);
      await f.h.runtime.reconcileSession(f.h.identity.userId, conversationId);

      const assistants = (await f.messages()).filter(m => m.role === 'assistant');
      expect(assistants).toHaveLength(1);
      expect(assistants[0]!.canvasArtifacts).toEqual((await f.delivery())!.canvasArtifacts);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    } finally { memFail?.mockRestore(); await f.close(); }
  }, 30000);

  it('follow-up retains visual data once without labeling unknown speech as heard', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    try {
      await f.begin(); await f.push(`${SPEECH}\n${block(VISUALS[0]!, 'ticks')}`);
      await f.until(() => f.ui.controller.getSnapshot().artifacts.length === 1);
      await f.crashStream(); await f.tick(2500);
      f.ui.controller.exit(); await f.tick(2500);
      const sessionId = f.binding.response.conversationId!;
      await f.h.runtime.reconcileSession(f.h.identity.userId, sessionId);
      await f.h.runtime.reconcileSession(f.h.identity.userId, sessionId);
      const before = f.h.fetcher.mock.calls.length;
      expect(before).toBe(1);
      const next = await f.h.runtime.submitTurn({ identity: f.h.identity, sessionId,
        content: 'What is node B?', idempotencyKey: 'canvas-follow-up-1' });
      await f.h.execute(next);
      expect(f.h.fetcher).toHaveBeenCalledTimes(before + 1);
      const request = JSON.parse(String(f.h.fetcher.mock.calls.at(-1)![1]!.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const visuals = request.messages.filter(m => m.content.startsWith('Retained Canvas artifacts ('));
      expect(visuals).toHaveLength(1); expect(visuals[0]!.role).toBe('assistant');
      expect(visuals[0]!.content).toContain('not spoken or proof of display');
      expect(visuals[0]!.content).toContain('A[Start] --> B[Finish]');
      expect(request.messages.filter(m => m.content === 'What is node B?')).toHaveLength(1);
      expect(request.messages.some(m => m.role === 'assistant' && m.content === SPEECH)).toBe(false);
      expect(request.messages.some(m => m.content.includes('delivery is unknown'))).toBe(true);
      expect(request.messages.some(m => m.role === 'system' && m.content.includes('A[Start] --> B[Finish]'))).toBe(false);
    } finally { await f.close(); }
  }, 30000);
});

type TimingRow = {
  scenario: string; clock: 'virtual-proxy';
  turnStart: number; virtualOutputProxy: number | null; artifactReceipt: number | null;
  firstRendered: number | null; walkthroughReference: number | null;
  underruns: number; underrunMs: number; interruptStart: number | null; interruptEnd: number | null;
};

function timingGates(row: TimingRow) {
  return {
    fiveSeconds: row.virtualOutputProxy === null ? 'unverified' : row.virtualOutputProxy - row.turnStart <= 5000 ? 'pass' : 'fail',
    visualBeforeReference: row.firstRendered === null || row.walkthroughReference === null ? 'unverified'
      : row.firstRendered < row.walkthroughReference ? 'pass' : 'fail',
    noUnderrun: row.underruns === 0 && row.underrunMs === 0 ? 'pass' : 'fail',
    localStop: row.interruptStart === null || row.interruptEnd === null ? 'unverified'
      : row.interruptEnd - row.interruptStart < 250 ? 'pass' : 'fail',
  };
}

describe('Timing traces and adverse-rate detection', () => {
  it('timing detector reports deadlines reference order gaps and interruption misses', () => {
    const normal: TimingRow = { scenario: 'oracle', clock: 'virtual-proxy', turnStart: 0,
      virtualOutputProxy: 300, artifactReceipt: 900, firstRendered: 900, walkthroughReference: 1200,
      underruns: 0, underrunMs: 0, interruptStart: 1300, interruptEnd: 1301 };
    expect(timingGates(normal)).toEqual({ fiveSeconds: 'pass', visualBeforeReference: 'pass', noUnderrun: 'pass', localStop: 'pass' });
    expect(timingGates({ ...normal, virtualOutputProxy: 5001 }).fiveSeconds).toBe('fail');
    expect(timingGates({ ...normal, firstRendered: 1200 }).visualBeforeReference).toBe('fail');
    expect(timingGates({ ...normal, underruns: 1, underrunMs: 400 }).noUnderrun).toBe('fail');
    expect(timingGates({ ...normal, interruptEnd: 1550 }).localStop).toBe('fail');
    expect(timingGates({ ...normal, virtualOutputProxy: null, firstRendered: null, walkthroughReference: null, interruptEnd: null }))
      .toMatchObject({ fiveSeconds: 'unverified', visualBeforeReference: 'unverified', localStop: 'unverified' });
  });

  it('bounds virtual bridge capture and requires explicit proof before heard delivery completes', async () => {
    vi.useFakeTimers(); const f = await canvasPipeline();
    try {
      await f.begin(); await f.push(`${SPEECH}\n`);
      await f.until(() => vi.mocked(f.tts.connection.speak).mock.calls.length > 0);
      for (let n = 0; n < 12; n++) { await f.audio(2400); await f.tick(50); }
      const watermarks = f.events.filter(event => event.type === 'audio.watermark');
      expect(f.source.captureFrame).toHaveBeenCalledTimes(12);
      expect(f.source.captured).toHaveLength(12);
      expect(watermarks).toHaveLength(12);
      expect(watermarks.at(-1)).toMatchObject({ queuedSamples: 28800, lastAudioSample: 28800 });

      await f.endModel();
      const ref = f.ref();
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 'canvas-speech',
        audioDurationMs: 1200, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: 1200, billableCharacters: 12 } });
      await f.until(() => f.events.some(event => event.type === 'audio.watermark' && event.final));
      const final = f.events.findLast(event => event.type === 'audio.watermark' && event.final);
      if (!final || final.type !== 'audio.watermark') throw new Error('Missing final watermark');
      expect((await f.delivery())?.status).not.toBe('completed');
      f.control({ type: 'playback.progress', turnId: ref.turnId, responseId: ref.responseId,
        playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24), proof: 'unproven' });
      await settle();
      expect((await f.delivery())?.status).not.toBe('completed');
      f.control({ type: 'playback.progress', turnId: ref.turnId, responseId: ref.responseId,
        playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24), proof: 'proven' });
      await f.until(() => f.bridge().currentResponse() === null);
      expect((await f.delivery())?.status).toBe('completed');
      expect((await f.delivery())?.textSpoken).toBe(SPEECH);
      expect(f.h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  }, 30000);
});

