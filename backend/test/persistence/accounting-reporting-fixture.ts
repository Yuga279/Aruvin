/**
 * ============================================================================
 * FILE: accounting-reporting-fixture.ts
 * LOCATION: backend/test/persistence/accounting-reporting-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide the shared offline interpreter for the read-only reporting pipeline.
 *
 * ROLE IN PROJECT:
 *    Lets the accounting reporting specs evaluate the exact pipeline operators
 *    without a live server. It lives outside a spec file so that importing it
 *    does not register another suite's tests, and it is not a MongoDB
 *    compatibility claim; the native fixtures validate the real server.
 *
 * KEY COMPONENTS:
 *    - evaluate: Runs a $match/$project/$group/$sort/$count/$facet pipeline.
 *    - compile: Compiles one pipeline expression once and reuses it per row.
 * ============================================================================
 */

import { Decimal128, type Document } from 'mongodb';
import { canonicalDecimal } from '../../src/contracts/usage-evidence.js';

const path = (doc: Document, field: string): unknown => {
  if (!field.includes('.')) return (doc as Record<string, unknown>)[field];
  return field.split('.').reduce<unknown>((v, k) =>
  v && typeof v === 'object' ? (v as Document)[k] : undefined, doc);
};
const eq = (a: unknown, b: unknown) => {
  const left = a ?? null, right = b ?? null;
  return left === right || JSON.stringify(left) === JSON.stringify(right);
};
function sum(values: unknown[]): number | Decimal128 {
  // A $sum over only nulls is zero, so it never needs decimal normalisation.
  if (values.every(v => v === null || v === undefined)) return 0;
  if (!values.some(v => v instanceof Decimal128)) return values.reduce<number>((n, v) => n + Number(v ?? 0), 0);
  // The canonical form of a decimal is a pure function of its text, so a
  // repeated amount is normalised once instead of once per row.
  const canonical = new Map<string, string>();
  const strings = values.map(v => {
    const raw = v instanceof Decimal128 ? v.toString() : String(typeof v === 'number' ? v : 0);
    const hit = canonical.get(raw);
    if (hit !== undefined) return hit;
    const text = canonicalDecimal(raw);
    canonical.set(raw, text);
    return text;
  });
  // Normalize BSON's scientific formatting before exact fixture arithmetic; no binary sums.
  let scale = 0;
  for (const text of strings) {
    const point = text.indexOf('.');
    const length = point < 0 ? 0 : text.length - point - 1;
    if (length > scale) scale = length;
  }
  let coefficient = 0n;
  for (const text of strings) {
    const point = text.indexOf('.');
    const whole = point < 0 ? text : text.slice(0, point);
    const fraction = point < 0 ? '' : text.slice(point + 1);
    coefficient += BigInt(whole + fraction) * 10n ** BigInt(scale - fraction.length);
  }
  const digits = coefficient.toString().padStart(scale + 1, '0');
  return Decimal128.fromString(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}
type Compiled = (doc: Document) => any;
// The pipeline shape is constant for every row, so each expression is compiled
// once and reused. The compiled form has the same meaning as the interpreter.
const COMPILED = new WeakMap<object, Compiled>();
function compile(value: unknown): Compiled {
  if (typeof value === 'string') {
    if (value.startsWith('$')) { const field = value.slice(1); return doc => path(doc, field) ?? null; }
    return () => value;
  }
  if (value === null || typeof value !== 'object' || value instanceof Decimal128) return () => value;
  if (Array.isArray(value)) {
    const parts = value.map(part => compile(part));
    return doc => parts.map(part => part(doc));
  }
  const object = value as Document;
  const cached = COMPILED.get(object);
  if (cached) return cached;
  let op = '';
  for (const key in object) { op = key; break; }
  const raw = object[op];
  let compiled: Compiled;
  if (op === '$literal') compiled = () => raw;
  else if (op === '$cond') {
    const [condition, yes, no] = raw as unknown[];
    const c = compile(condition), t = compile(yes), f = compile(no);
    compiled = doc => (c(doc) ? t(doc) : f(doc));
  } else if (op === '$ifNull' || op === '$eq' || op === '$ne' || op === '$gt' || op === '$subtract' || op === '$in') {
    const [a, b] = raw as unknown[];
    const ac = compile(a), bc = compile(b);
    compiled = doc => {
      const left = ac(doc), right = bc(doc);
      if (op === '$ifNull') return left ?? right;
      if (op === '$eq') return eq(left, right);
      if (op === '$ne') return !eq(left, right);
      if (op === '$gt') return left > right;
      if (op === '$subtract') return left - right;
      return right.some((v: unknown) => eq(left, v));
    };
  } else if (op === '$and' || op === '$or') {
    const parts = (raw as unknown[]).map(part => compile(part));
    compiled = doc => {
      const values = parts.map(part => part(doc));
      return op === '$and' ? values.every(Boolean) : values.some(Boolean);
    };
  } else if (op === '$toString') {
    const inner = compile(raw);
    compiled = doc => { const v = inner(doc); return v === null ? null : String(v); };
  } else if (op === '$convert') {
    const inner = compile(raw.input);
    compiled = doc => { const v = inner(doc); return v === null ? null : Decimal128.fromString(String(v)); };
  } else {
    const entries = Object.entries(object).map(([k, v]) => [k, compile(v)] as [string, Compiled]);
    compiled = doc => Object.fromEntries(entries.map(([k, c]) => [k, c(doc)]));
  }
  COMPILED.set(object, compiled);
  return compiled;
}
function expression(value: unknown, doc: Document): any {
  if (typeof value === 'string' && value.startsWith('$')) return path(doc, value.slice(1)) ?? null;
  if (value === null || typeof value !== 'object' || value instanceof Decimal128) return value;
  if (Array.isArray(value)) return value.map(v => expression(v, doc));
  return compile(value)(doc);
}
export function match(doc: Document, filter: Document): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((f: Document) => match(doc, f));
    if (key === '$and') return value.every((f: Document) => match(doc, f));
    const current = path(doc, key);
    if (!value || typeof value !== 'object') return eq(current, value);
    return Object.entries(value).every(([op, v]) => op === '$in' ? (v as unknown[]).some(x => eq(current, x))
      : op === '$nin' ? !(v as unknown[]).some(x => eq(current, x)) : op === '$ne' ? !eq(current, v)
        : op === '$gte' ? (current as string) >= (v as string) : op === '$lt' ? (current as string) < (v as string)
          : op === '$gt' ? (current as string) > (v as string) : eq(current, v));
  });
}
export function evaluate(rows: Document[], pipeline: Document[]): Document[] {
  for (const stage of pipeline) {
    if (stage.$match) rows = rows.filter(r => match(r, stage.$match));
    else if (stage.$limit) rows = rows.slice(0, stage.$limit);
    else if (stage.$project) {
      // The projection shape is the same for every row, so it is resolved once.
      const fields = Object.entries(stage.$project).filter(([, v]) => v !== 0);
      rows = rows.map(r => Object.fromEntries(fields.map(([k, v]) => [k, v === 1 ? r[k] : expression(v, r)])));
    }
    else if (stage.$group) {
      const groups = new Map<string, Document[]>();
      for (const row of rows) { const key = JSON.stringify(expression(stage.$group._id, row));
        if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(row); }
      rows = [...groups.entries()].map(([key, group]) => ({ _id: JSON.parse(key), ...Object.fromEntries(Object.entries(stage.$group)
        .filter(([k]) => k !== '_id').map(([k, accumulator]) => { const [op, v] = Object.entries(accumulator as Document)[0];
          const values = group.map(r => expression(v, r)); return [k, op === '$sum' ? sum(values) : Math.max(...values.map(Number))]; })) }));
    } else if (stage.$sort) rows = [...rows].sort((a, b) => {
      for (const [key, direction] of Object.entries(stage.$sort)) { const av = path(a, key) as string, bv = path(b, key) as string;
        if (av !== bv) return (av < bv ? -1 : 1) * Number(direction); } return 0;
    });
    else if (stage.$count) rows = rows.length ? [{ [stage.$count]: rows.length }] : [];
    else if (stage.$facet) rows = [Object.fromEntries(Object.entries(stage.$facet).map(([k, p]) => [k, evaluate(rows, p as Document[])]))];
    else throw new Error('Unexpected reporting stage.');
  }
  return rows;
}
