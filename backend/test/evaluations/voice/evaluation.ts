/**
 * ============================================================================
 * FILE: evaluation.ts
 * LOCATION: backend/test/evaluations/voice/evaluation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Evaluation math helpers and Zod pilot artifact schema for voice benchmarks.
 *
 * ROLE IN PROJECT:
 *    Calculates p50/p95 latency percentiles, word error rate (Levenshtein distance),
 *    critical keyword presence, and validates operator-supplied pilot datasets.
 *
 * KEY COMPONENTS:
 *    - pilotSchema: Zod schema for hardware/simulated pilot datasets
 *    - percentile: Nearest-rank percentile computation
 *    - wordErrorRate: Word-level edit distance computation
 *    - evaluate: Evaluates full pilot or simulated dataset
 * ============================================================================
 */

import { z } from 'zod';
const count = z.number().int().nonnegative().max(10_000);
const ms = z.number().finite().nonnegative().max(86_400_000);
const text = z.string().min(1).max(32_000);
const sample = z.object({ speechEndMs: ms, endOfTurnMs: ms, firstPlayedMs: ms,
  cold: z.boolean() }).strict().refine(v => v.speechEndMs <= v.endOfTurnMs && v.endOfTurnMs <= v.firstPlayedMs,
  'Timing must be monotonic in one aligned clock');
export const pilotSchema = z.object({
  evidence: z.enum(['simulated', 'provider-fixture', 'hardware-pilot']),
  samples: z.array(sample).min(1).max(10_000),
  utterances: z.array(z.object({ reference: text, hypothesis: z.string().max(32_000),
    critical: z.array(text).min(1).max(32) }).strict()).min(1).max(1000),
  tasks: z.array(z.object({ id: z.string().min(1).max(128), textSuccess: z.boolean(), voiceSuccess: z.boolean() }).strict()).min(1).max(1000),
  starts: count.min(1), ready: count, earlyCutoffs: count, labeledTurns: count.min(1),
  invalidAcceptances: count, duplicateExecutions: count,
  versions: z.object({ stt: text, tts: text, llm: text }).strict(),
  provenance: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), runId: text,
    consentRef: text, authorizationRef: text }).strict(),
}).strict().superRefine((v, ctx) => {
  if (v.ready > v.starts || v.earlyCutoffs > v.labeledTurns)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid denominators' });
  if (new Set(v.tasks.map(t => t.id)).size !== v.tasks.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate matched task IDs' });
});

export function percentile(values: number[], fraction: number) {
  if (!values.length || fraction <= 0 || fraction > 1 ||
    values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid percentile sample');
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * fraction) - 1];
}
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_-]+(?:\.[\p{N}]+)?/gu) ?? [];
function edits(reference: string, hypothesis: string) {
  const a = words(reference), b = words(hypothesis);
  if (!a.length) throw new Error('Reference needs labeled words');
  // ponytail: O(n*m) edit-distance time, O(m) memory; cap tokens for this offline
  // corpus harness. Use a banded algorithm if longer utterances are admitted.
  if (a.length > 2000 || b.length > 2000) throw new Error('Utterance token budget exceeded');
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(
      next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return { distance: row[b.length], referenceWords: a.length };
}
export function wordErrorRate(reference: string, hypothesis: string) {
  const v = edits(reference, hypothesis); return v.distance / v.referenceWords;
}
export function evaluate(input: unknown) {
  const p = pilotSchema.parse(input), pairs = p.utterances.map(u => edits(u.reference, u.hypothesis));
  const warm = p.samples.filter(s => !s.cold).map(s => s.firstPlayedMs - s.speechEndMs);
  const cold = p.samples.filter(s => s.cold).map(s => s.firstPlayedMs - s.speechEndMs);
  const critical = p.utterances.flatMap(u => u.critical.map(value => {
    const expected = words(value).join(' '), hypothesis = ` ${words(u.hypothesis).join(' ')} `;
    return Number(hypothesis.includes(` ${expected} `));
  }));
  const textSuccess = p.tasks.filter(t => t.textSuccess).length / p.tasks.length;
  const voiceSuccess = p.tasks.filter(t => t.voiceSuccess).length / p.tasks.length;
  return {
    firstAudio: { p50: percentile(warm, 0.5), p95: percentile(warm, 0.95) },
    coldFirstAudio: cold.length ? { p50: percentile(cold, 0.5), p95: percentile(cold, 0.95) } : null,
    wer: pairs.reduce((n, v) => n + v.distance, 0) / pairs.reduce((n, v) => n + v.referenceWords, 0),
    criticalAccuracy: critical.reduce((n, v) => n + v, 0) / critical.length,
    establishmentRate: p.ready / p.starts, earlyCutoffRate: p.earlyCutoffs / p.labeledTurns,
    taskGapPercentagePoints: Math.max(0, (textSuccess - voiceSuccess) * 100),
    utterances: p.utterances.length, matchedTasks: p.tasks.length,
    certifiable: p.evidence === 'hardware-pilot' && p.utterances.length >= 100 && p.tasks.length >= 30 && warm.length >= 30,
  };
}
