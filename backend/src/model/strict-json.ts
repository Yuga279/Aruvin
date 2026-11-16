import { CALENDAR_LIMITS, type CalendarLimits } from '../contracts/calendar-policy.js';
import { forbiddenCalendarKeys } from '../contracts/calendar-tools.js';

export type ScanCode = 'malformed-json' | 'duplicate-key' | 'byte-limit' | 'depth-limit';
export type JsonScan = { code: ScanCode | null; forbidden: boolean };
const denied = new Set<string>(forbiddenCalendarKeys);

export function scanJsonObject(raw: string, limits: Pick<CalendarLimits, 'argumentBytes' | 'jsonDepth'> = CALENDAR_LIMITS): JsonScan {
  if (Buffer.byteLength(raw, 'utf8') > limits.argumentBytes) return { code: 'byte-limit', forbidden: false };
  let i = 0, forbidden = false, duplicate = false;
  const fail = (code: ScanCode): never => { throw code; };
  const ws = () => { while (i < raw.length && /[\x20\t\r\n]/.test(raw[i])) i++; };
  const string = (): string => {
    const begin = i;
    if (raw[i++] !== '"') return fail('malformed-json');
    while (i < raw.length) {
      const c = raw[i++];
      if (c === '"') return JSON.parse(raw.slice(begin, i)) as string;
      if (c.charCodeAt(0) < 32) return fail('malformed-json');
      if (c === '\\') {
        const escape = raw[i++];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(i, i + 4))) return fail('malformed-json');
          i += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) return fail('malformed-json');
      }
    }
    return fail('malformed-json');
  };
  const value = (depth: number): void => {
    ws();
    if (raw[i] === '{' || raw[i] === '[') {
      if (depth >= limits.jsonDepth) return fail('depth-limit');
      const object = raw[i++] === '{', end = object ? '}' : ']';
      const keys = new Set<string>();
      ws(); if (raw[i] === end) { i++; return; }
      while (i < raw.length) {
        if (object) {
          ws(); const key = string();
          forbidden ||= denied.has(key);
          if (keys.has(key)) duplicate = true;
          keys.add(key); ws();
          if (raw[i++] !== ':') return fail('malformed-json');
        }
        value(depth + 1); ws();
        if (raw[i] === end) { i++; return; }
        if (raw[i++] !== ',') return fail('malformed-json');
      }
      return fail('malformed-json');
    }
    if (raw[i] === '"') { string(); return; }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(i))?.[0];
    if (!token) return fail('malformed-json');
    if (/^-?\d/.test(token) && !Number.isFinite(Number(token))) return fail('malformed-json');
    i += token.length;
  };
  try {
    ws(); if (raw[i] !== '{') return fail('malformed-json');
    value(0); ws(); if (i !== raw.length) return fail('malformed-json');
    return { code: duplicate ? 'duplicate-key' : null, forbidden };
  } catch (code) {
    return { code: typeof code === 'string' ? code as ScanCode : 'malformed-json', forbidden };
  }
}
