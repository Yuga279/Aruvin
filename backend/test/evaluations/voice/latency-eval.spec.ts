/**
 * ============================================================================
 * FILE: latency-eval.spec.ts
 * LOCATION: backend/test/evaluations/voice/latency-eval.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Calibration and offline evaluation harness tests for voice latency and accuracy.
 *
 * ROLE IN PROJECT:
 *    Tests p50/p95 percentile math, word error rate calculation, critical keyword preservation,
 *    synthetic Nova STT transcript normalization, SpeechProse filtering, and hardware-pilot validation.
 *
 * KEY COMPONENTS:
 *    - evaluate, pilotSchema, percentile, wordErrorRate from evaluation.js
 *    - NovaSttAdapter normalization tests
 *    - SpeechProse chunked prose filtering tests
 * ============================================================================
 */

import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, pilotSchema, percentile, wordErrorRate } from './evaluation.js';
import { SpeechProse } from '../../../src/voice/agent/speech-prose.js';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import { config, input, harness, collect, tick, novaResult } from '../../fixtures/deepgram/socket.js';
import type { SttEvent } from '../../../src/contracts/voice.js';

it('calibrates p50/p95 using played audio and includes turn-detection time', () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({ speechEndMs: 1000,
    endOfTurnMs: 1200, firstPlayedMs: 2000 + i * 10, cold: false }));
  const result = evaluate({ evidence: 'simulated', samples,
    utterances: [{ reference: 'Do not change ABC-42.', hypothesis: 'Do not change ABC-42.', critical: ['not', 'ABC-42'] }],
    tasks: Array.from({ length: 30 }, (_, i) => ({ id: `simulated-task-${i}`,
      textSuccess: true, voiceSuccess: i !== 29 })),
    starts: 100, ready: 99, earlyCutoffs: 0, labeledTurns: 100,
    invalidAcceptances: 0, duplicateExecutions: 0,
    versions: { stt: 'fixture', tts: 'fixture', llm: 'fixture' },
    provenance: { commit: '0'.repeat(40), runId: 'simulation', consentRef: 'synthetic', authorizationRef: 'offline' } });
  expect(result.firstAudio).toEqual({ p50: 1490, p95: 1940 });
  expect(result.matchedTasks).toBe(30);
  expect(result.taskGapPercentagePoints).toBeCloseTo(100 / 30);
  expect(result.certifiable).toBe(false);
  expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  expect(() => percentile([], 0.5)).toThrow();
});

it('computes substitutions deletions insertions and detects critical negation/value loss', () => {
  expect(wordErrorRate('do not change ABC-42', 'do change ABC-43')).toBe(0.5);
  expect(wordErrorRate('a b', 'a x b')).toBe(0.5);
  expect(() => wordErrorRate('', 'invented')).toThrow();
  const base = { evidence: 'simulated', samples: [{ speechEndMs: 0, endOfTurnMs: 100, firstPlayedMs: 500, cold: false }],
    utterances: [{ reference: 'Do not change ABC-42.', hypothesis: 'Do change ABC-43.', critical: ['not', 'ABC-42'] }],
    tasks: [{ id: 'one', textSuccess: true, voiceSuccess: false }], starts: 1, ready: 1,
    earlyCutoffs: 0, labeledTurns: 1, invalidAcceptances: 0, duplicateExecutions: 0,
    versions: { stt: 'fixture', tts: 'fixture', llm: 'fixture' },
    provenance: { commit: '0'.repeat(40), runId: 'simulation', consentRef: 'synthetic', authorizationRef: 'offline' } };
  expect(evaluate(base).criticalAccuracy).toBe(0);
  expect(evaluate(base).taskGapPercentagePoints).toBe(100);
  expect(() => evaluate({ ...base, samples: [{ speechEndMs: 100, endOfTurnMs: 150, firstPlayedMs: 90, cold: false }] })).toThrow();
});

it('passes 100 synthetic utterance transcripts through the actual Nova adapter without duplicated finals', async () => {
  const h = harness(), c = await new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = [], reading = collect(c.events, events);
  const references = Array.from({ length: 100 }, (_, i) =>
    `Do not change ID ABC-${i + 100} for Priya on 2026-10-09. Repeat repeat ${i + 1}.`);
  try {
    for (const [i, reference] of references.entries()) {
      h.sockets[0].json(novaResult(reference, false, i));
      h.sockets[0].json(novaResult(reference, true, i));
      h.sockets[0].json(novaResult(reference, true, i));
    }
    await tick();
    await vi.waitFor(() => expect(events.filter(e => e.type === 'final')).toHaveLength(100));
    const finals = events.flatMap(e => e.type === 'final' ? [e.text] : []);
    expect(finals).toEqual(references);
    expect(finals.map((s, i) => wordErrorRate(references[i], s))).toEqual(Array(100).fill(0));
  } finally { await c.close(); await reading; }
});

it('filters prose at every stream split without altering dates identifiers amounts or negations', () => {
  const source = '<think>PRIVATE reasoning.</think>\n**Do not** change ABC-42.\n' +
    '```json\n{"secret":true}\n```\nPrice is 12.50 on 2026-10-09. Repeat repeat.';
  const expected = 'Do not change ABC-42. Price is 12.50 on 2026-10-09. Repeat repeat.';
  for (let cut = 0; cut <= source.length; cut++) {
    const prose = new SpeechProse();
    expect(prose.push(source.slice(0, cut)) + prose.push(source.slice(cut)) + prose.finish()).toBe(expected);
  }
});

describe.skipIf(!process.env.AURVIN_VOICE_PILOT_EVIDENCE)('operator-supplied hardware pilot artifact', () => {
  it('evaluates at least 100 utterances and 30 matched no-tool tasks without claiming synthetic certification', () => {
    const path = process.env.AURVIN_VOICE_PILOT_EVIDENCE!;
    if (statSync(path).size > 2_000_000) throw new Error('Pilot artifact exceeds its bound');
    const raw = readFileSync(path, 'utf8');
    if (Buffer.byteLength(raw) > 2_000_000) throw new Error('Pilot artifact exceeds its bound');
    const pilot = pilotSchema.parse(JSON.parse(raw));
    expect(pilot.evidence).toBe('hardware-pilot');
    expect(pilot.utterances.length).toBeGreaterThanOrEqual(100);
    expect(pilot.tasks.length).toBeGreaterThanOrEqual(30);
    expect(pilot.samples.length).toBeGreaterThanOrEqual(30);
    expect(pilot.versions.stt).not.toMatch(/fixture|synthetic|unknown/);
    expect(pilot.versions.tts).not.toMatch(/fixture|synthetic|unknown/);
    expect(pilot.versions.llm).not.toMatch(/fixture|synthetic|unknown/);
    const result = evaluate(pilot);
    expect(result.certifiable).toBe(true); // Eligible dataset, not approval of provenance or every release gate.
    expect(result.firstAudio.p50).toBeLessThanOrEqual(1500);
    expect(result.firstAudio.p95).toBeLessThanOrEqual(2500);
    expect(result.wer).toBeLessThanOrEqual(0.10);
    expect(result.criticalAccuracy).toBeGreaterThanOrEqual(0.98);
    expect(result.establishmentRate).toBeGreaterThanOrEqual(0.98);
    expect(result.earlyCutoffRate).toBeLessThan(0.05);
    expect(result.taskGapPercentagePoints).toBeLessThanOrEqual(5);
    expect(pilot.invalidAcceptances).toBe(0);
    expect(pilot.duplicateExecutions).toBe(0);
    // Never log the artifact's reference/hypothesis text or credentials.
    console.info(JSON.stringify({ runId: pilot.provenance.runId, evidence: pilot.evidence, ...result }));
  });
});
