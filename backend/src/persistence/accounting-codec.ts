/**
 * ============================================================================
 * FILE: accounting-codec.ts
 * LOCATION: backend/src/persistence/accounting-codec.ts
 * PURPOSE: Map canonical monetary strings to BSON only for accounting kinds.
 * ROLE IN PROJECT: RecordStore bounds and CAS rereads share this narrow codec.
 * KEY COMPONENTS: encodeAccountingMoney/decodeAccountingMoney; no checkpoint codec.
 * ============================================================================
 */
import { Decimal128, type Document } from 'mongodb';
import { canonicalDecimal } from '../contracts/usage-evidence.js';

const legacy = (doc: Document) => ['accounting', 'voice-accounting'].includes(String(doc.kind));

function toDecimal(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Decimal128) return value;
  return Decimal128.fromString(canonicalDecimal(String(value)));
}

function fromDecimal(value: unknown): unknown {
  if (value instanceof Decimal128) return canonicalDecimal(value.toString());
  return value;
}

function encodeMoney(money: Record<string, unknown> | undefined) {
  if (!money) return money;
  const next = { ...money };
  for (const field of ['reportedAmount', 'estimatedAmount']) next[field] = toDecimal(next[field]);
  if (next.pricing) {
    const pricing = { ...(next.pricing as Document) };
    pricing.rateUsd = toDecimal(pricing.rateUsd);
    next.pricing = pricing;
  }
  return next;
}

function decodeMoney(money: Record<string, unknown> | undefined) {
  if (!money) return money;
  const next = { ...money };
  for (const field of ['reportedAmount', 'estimatedAmount']) next[field] = fromDecimal(next[field]);
  if (next.pricing) {
    const pricing = { ...(next.pricing as Document) };
    pricing.rateUsd = fromDecimal(pricing.rateUsd);
    next.pricing = pricing;
  }
  return next;
}

export function encodeAccountingMoney<T extends Document>(doc: T): T {
  const kind = String(doc.kind);
  if (legacy(doc)) {
    if (!doc.money) return doc;
    return { ...doc, money: encodeMoney(doc.money as Record<string, unknown>) };
  }
  if (kind === 'calendar-turn-budget') {
    const claims = Array.isArray(doc._calendarClaims)
      ? (doc._calendarClaims as Document[]).map((claim) => ({
          ...claim, reservationUsd: toDecimal(claim.reservationUsd),
        }))
      : doc._calendarClaims;
    return {
      ...doc,
      settledUsd: toDecimal(doc.settledUsd),
      reservedUsd: toDecimal(doc.reservedUsd),
      ...(claims !== undefined ? { _calendarClaims: claims } : {}),
    };
  }
  if (kind === 'calendar-model-dispatch') {
    const pricing = doc.pricing ? {
      ...(doc.pricing as Document),
      promptUsdPerToken: toDecimal((doc.pricing as Document).promptUsdPerToken),
      completionUsdPerToken: toDecimal((doc.pricing as Document).completionUsdPerToken),
      requestUsd: toDecimal((doc.pricing as Document).requestUsd),
    } : doc.pricing;
    return {
      ...doc,
      reservationUsd: toDecimal(doc.reservationUsd),
      money: encodeMoney(doc.money as Record<string, unknown>),
      pricing,
    };
  }
  if (kind === 'calendar-model-aggregate') {
    return {
      ...doc,
      reportedUsd: doc.reportedUsd == null ? doc.reportedUsd : toDecimal(doc.reportedUsd),
      heldReservationUsd: toDecimal(doc.heldReservationUsd),
      connectorMoney: encodeMoney(doc.connectorMoney as Record<string, unknown>),
    };
  }
  return doc;
}

export function decodeAccountingMoney(doc: Document): Document {
  const kind = String(doc.kind);
  if (legacy(doc)) {
    if (!doc.money) return doc;
    return { ...doc, money: decodeMoney(doc.money as Record<string, unknown>) };
  }
  if (kind === 'calendar-turn-budget') {
    const claims = Array.isArray(doc._calendarClaims)
      ? (doc._calendarClaims as Document[]).map((claim) => ({
          ...claim, reservationUsd: fromDecimal(claim.reservationUsd),
        }))
      : doc._calendarClaims;
    return {
      ...doc,
      settledUsd: fromDecimal(doc.settledUsd),
      reservedUsd: fromDecimal(doc.reservedUsd),
      ...(claims !== undefined ? { _calendarClaims: claims } : {}),
    };
  }
  if (kind === 'calendar-model-dispatch') {
    const pricing = doc.pricing ? {
      ...(doc.pricing as Document),
      promptUsdPerToken: fromDecimal((doc.pricing as Document).promptUsdPerToken),
      completionUsdPerToken: fromDecimal((doc.pricing as Document).completionUsdPerToken),
      requestUsd: fromDecimal((doc.pricing as Document).requestUsd),
    } : doc.pricing;
    return {
      ...doc,
      reservationUsd: fromDecimal(doc.reservationUsd),
      money: decodeMoney(doc.money as Record<string, unknown>),
      pricing,
    };
  }
  if (kind === 'calendar-model-aggregate') {
    return {
      ...doc,
      reportedUsd: fromDecimal(doc.reportedUsd),
      heldReservationUsd: fromDecimal(doc.heldReservationUsd),
      connectorMoney: decodeMoney(doc.connectorMoney as Record<string, unknown>),
    };
  }
  return doc;
}
