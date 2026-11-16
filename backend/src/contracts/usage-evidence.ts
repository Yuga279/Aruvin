/**
 * ============================================================================
 * FILE: usage-evidence.ts
 * LOCATION: backend/src/contracts/usage-evidence.ts
 * PURPOSE: Define bounded JSON-safe monetary provenance and measured timing.
 * ROLE IN PROJECT: Shared text/voice evidence; BSON stays in persistence codecs.
 * KEY COMPONENTS: Canonical decimals, money schema, timing schema, legacy conversion.
 * ============================================================================
 */
import { z } from 'zod';
const observationUtc = z.string().length(24).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);

// Decimal128 has 34 significant digits. Bound scale/length without rounding.
export const decimalSchema = z.string().max(400).regex(/^(0|[1-9]\d*)(\.\d*[1-9])?$/)
  .refine(v => v.replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length <= 34);
export function decimalFromNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid monetary value.');
  return canonicalDecimal(String(value));
}
export function canonicalDecimal(value: string): string {
  if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value) || value.length > 410) throw new Error('Invalid decimal.');
  const [mantissa, exponent] = value.toLowerCase().split('e');
  const shift = Number(exponent ?? 0);
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 400) throw new Error('Decimal scale exceeded.');
  const digits = mantissa.replace('.', '');
  const point = (mantissa.indexOf('.') < 0 ? mantissa.length : mantissa.indexOf('.')) + shift;
  const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [whole, fraction] = expanded.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction?.replace(/0+$/, '');
  return decimalSchema.parse(normalizedWhole + (normalizedFraction ? `.${normalizedFraction}` : ''));
}
export const usageCountSchema = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export function characterEstimate(units: number, rateUsd: string): string {
  usageCountSchema.parse(units); decimalSchema.parse(rateUsd);
  const scale = (rateUsd.split('.')[1]?.length ?? 0) + 3;
  return canonicalDecimal(`${BigInt(rateUsd.replace('.', '')) * BigInt(units)}e-${scale}`);
}
export const moneyEvidenceSchema = z.object({
  currency: z.literal('USD'), reportedAmount: decimalSchema.nullable(), estimatedAmount: decimalSchema.nullable(),
  costStatus: z.enum(['known', 'pending', 'unknown']),
  source: z.enum(['provider-response', 'provider-generation', 'provider-estimate', 'legacy-number', 'unavailable']),
  observedAt: observationUtc.nullable(),
  pricing: z.object({ version: z.string().min(1).max(64), source: z.string().min(1).max(200),
    unit: z.literal('characters'), units: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    unitSize: z.literal(1000), rateUsd: decimalSchema }).strict().nullable(),
}).strict().superRefine((v, ctx) => {
  let pricingConsistent = true;
  if (v.pricing) {
    try { pricingConsistent = characterEstimate(v.pricing.units, v.pricing.rateUsd) === v.estimatedAmount; }
    catch { pricingConsistent = false; }
  }
  if ((v.costStatus === 'known') !== (v.reportedAmount !== null)
    || (v.source === 'unavailable') !== (v.reportedAmount === null && v.estimatedAmount === null)
    || (v.source === 'provider-estimate' && (v.estimatedAmount === null || v.reportedAmount !== null))
    || (['provider-response', 'provider-generation'].includes(v.source) && v.reportedAmount === null)
    || ((v.reportedAmount !== null || v.estimatedAmount !== null) && v.observedAt === null)
    || (v.estimatedAmount !== null && v.source !== 'legacy-number' && v.pricing === null)
    || !pricingConsistent)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent monetary evidence.' });
});
export type MoneyEvidence = z.infer<typeof moneyEvidenceSchema>;
export const unavailableMoney = (pending = false): MoneyEvidence => ({ currency: 'USD', reportedAmount: null,
  estimatedAmount: null, costStatus: pending ? 'pending' : 'unknown', source: 'unavailable', observedAt: null, pricing: null });
export const timingEvidenceSchema = z.object({
  dispatchedAt: observationUtc.nullable(), firstOutputAt: observationUtc.nullable(), providerEndedAt: observationUtc.nullable(),
  durableCompletedAt: observationUtc.nullable(), providerDurationMs: z.number().finite().nonnegative().max(3_600_000).nullable(),
  firstOutputLatencyMs: z.number().finite().nonnegative().max(3_600_000).nullable(),
  dispatchCount: z.number().int().nonnegative().max(3).nullable(),
}).strict();
export type TimingEvidence = z.infer<typeof timingEvidenceSchema>;
export const emptyTiming = (): TimingEvidence => ({ dispatchedAt: null, firstOutputAt: null, providerEndedAt: null,
  durableCompletedAt: null, providerDurationMs: null, firstOutputLatencyMs: null, dispatchCount: null });
export function compatibleAmount(compatibility: number | null, canonical: string | null): boolean {
  // Canonical evidence can carry more precision than a legacy double; compare its projection, never sum both.
  return compatibility === null ? canonical === null : canonical !== null && Number(canonical) === compatibility;
}
