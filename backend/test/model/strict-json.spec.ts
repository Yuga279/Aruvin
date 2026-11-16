import { scanJsonObject } from '../../src/model/strict-json.js';
import { CALENDAR_LIMITS } from '../../src/contracts/calendar-policy.js';

describe('strict Calendar JSON', () => {
  it('rejects decoded duplicate keys and trailing content', () => {
    for (const raw of [
      '{"eventId":"a","eventId":"b"}',
      '{"\\u0065ventId":"a","eventId":"b"}',
      '{"x":{"k":1,"\\u006b":2}}',
    ]) expect(scanJsonObject(raw, CALENDAR_LIMITS)).toMatchObject({ code: 'duplicate-key' });
    for (const raw of ['{}{}', '{} true', '```json\n{}\n```', '[]', 'null', '{"x":01}', '{"x":1,}', '{"x":NaN}']) {
      expect(scanJsonObject(raw, CALENDAR_LIMITS)).toMatchObject({ code: 'malformed-json' });
    }
    expect(scanJsonObject(' {"eventId":"a\\"b"}\r\n', CALENDAR_LIMITS)).toMatchObject({ code: null });
  });

  it('bounds UTF8 bytes and object-array nesting before allocation', () => {
    expect(scanJsonObject('{"x":"' + 'é'.repeat(8192) + '"}', CALENDAR_LIMITS).code).toBe('byte-limit');
    const depth8 = '{"x":'.repeat(8) + '0' + '}'.repeat(8);
    expect(scanJsonObject(depth8, CALENDAR_LIMITS).code).toBeNull();
    expect(scanJsonObject('{"x":' + depth8 + '}', CALENDAR_LIMITS).code).toBe('depth-limit');
    expect(scanJsonObject('{"x":[{"attendees":[]}] trailing', CALENDAR_LIMITS).forbidden).toBe(true);
  });

  it.each([
    ['{}', null],
    [' { } ', null],
    ['\t{\n"x"\r:\t1\n}\r\n', null],
    ['{"x":-1}', null],
    ['{"x":-1.5}', null],
    ['{"x":1e2}', null],
    ['{"x":-1.5e-2}', null],
    ['{"x":0.0}', null],
    ['{"x":[1,{"y":[true,false,null]}]}', null],
    ['{"":1}', null],
    ['{"a":{"k":1},"b":{"k":2}}', null],
    ['{"x":"{,}"}', null],
    ['{"x":"[}{]"}', null],
    ['{"__proto__":1,"constructor":2}', null],
    ['{"x":"\\uD800"}', null],
    ['{"x":"a\\n\\t"}', null],
    ['{"x":1} \t\r\n', null],
  ])('accepts valid JSON grammar %s', (raw, code) => {
    expect(scanJsonObject(raw, CALENDAR_LIMITS)).toMatchObject({ code, forbidden: false });
  });

  it.each([
    ['\u00A0{}', 'malformed-json'],
    ['\f{}', 'malformed-json'],
    ['\v{}', 'malformed-json'],
    ['{}\u00A0', 'malformed-json'],
    ['{"x":\u0001}', 'malformed-json'],
    ['{"x":"\u0001"}', 'malformed-json'],
    ['{"x":"\\q"}', 'malformed-json'],
    ['{"x":"\\u12"}', 'malformed-json'],
    ['{"x":"\\uXXXX"}', 'malformed-json'],
    ['{"x":"\\"}', 'malformed-json'],
    ['{"x":1e400}', 'malformed-json'],
    ['{"x":-1e400}', 'malformed-json'],
    ['{"x":Infinity}', 'malformed-json'],
    ['{"x":.1}', 'malformed-json'],
    ['{"x":1.}', 'malformed-json'],
    ['{"x":+1}', 'malformed-json'],
    ["{'x':1}", 'malformed-json'],
    ['{x:1}', 'malformed-json'],
    ['{"x":undefined}', 'malformed-json'],
  ])('rejects invalid grammar %s', (raw, code) => {
    expect(scanJsonObject(raw, CALENDAR_LIMITS)).toMatchObject({ code });
  });

  it('enforces exact 16384-byte ASCII and multibyte caps', () => {
    const asciiOk = '{"x":"' + 'a'.repeat(16376) + '"}';
    expect(Buffer.byteLength(asciiOk, 'utf8')).toBe(16384);
    expect(scanJsonObject(asciiOk, CALENDAR_LIMITS).code).toBeNull();
    const asciiOver = '{"x":"' + 'a'.repeat(16377) + '"}';
    expect(Buffer.byteLength(asciiOver, 'utf8')).toBe(16385);
    expect(scanJsonObject(asciiOver, CALENDAR_LIMITS).code).toBe('byte-limit');
    const multiOk = '{"x":"' + 'é'.repeat(8188) + '"}';
    expect(Buffer.byteLength(multiOk, 'utf8')).toBe(16384);
    expect(scanJsonObject(multiOk, CALENDAR_LIMITS).code).toBeNull();
    const multiOver = '{"x":"' + 'é'.repeat(8188) + 'a"}';
    expect(Buffer.byteLength(multiOver, 'utf8')).toBe(16385);
    expect(scanJsonObject(multiOver, CALENDAR_LIMITS).code).toBe('byte-limit');
  });

  it('respects configured smaller byte and depth caps', () => {
    const smallBytes = { argumentBytes: 16, jsonDepth: 8 };
    expect(scanJsonObject('{"x":1}', smallBytes).code).toBeNull();
    expect(scanJsonObject('{"x":"abcdefghij"}', smallBytes).code).toBe('byte-limit');
    const smallDepth = { argumentBytes: 64, jsonDepth: 2 };
    expect(scanJsonObject('{"x":{"y":0}}', smallDepth).code).toBeNull();
    expect(scanJsonObject('{"x":{"y":{"z":0}}}', smallDepth).code).toBe('depth-limit');
    const depth8 = '{"x":'.repeat(8) + '0' + '}'.repeat(8);
    const depth9 = '{"x":' + depth8 + '}';
    expect(scanJsonObject(depth8, CALENDAR_LIMITS).code).toBeNull();
    expect(scanJsonObject(depth9, CALENDAR_LIMITS).code).toBe('depth-limit');
  });

  it('keeps forbidden sightings through duplicate and syntax errors', () => {
    expect(scanJsonObject('{"eventId":"a","eventId":"b","attendees":[]}', CALENDAR_LIMITS))
      .toEqual({ code: 'duplicate-key', forbidden: true });
    expect(scanJsonObject('{"attendees":[],"eventId":"a","eventId":"b"}', CALENDAR_LIMITS))
      .toEqual({ code: 'duplicate-key', forbidden: true });
    expect(scanJsonObject('{"\\u0061ttendees":[]}', CALENDAR_LIMITS))
      .toEqual({ code: null, forbidden: true });
    expect(scanJsonObject('{"x":{"accessToken":"SECRET"} trailing', CALENDAR_LIMITS).forbidden).toBe(true);
    expect(JSON.stringify(scanJsonObject('{"accessToken":"SECRET"}', CALENDAR_LIMITS)))
      .not.toContain('SECRET');
  });
});
