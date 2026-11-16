import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CALENDAR_TOOLS, calendarInputSchemas, calendarResultSchema,
  forbiddenCalendarKeys, jsonBytes } from '../../src/contracts/calendar-tools.js';

const create = { summary: 'Visit', start: '2026-10-21T10:00:00+01:00',
  end: '2026-10-21T11:00:00+01:00', timeZone: 'Europe/London' };
describe('strict Calendar catalogue', () => {
  it('has exactly five versioned tools with strict matching field definitions', () => {
    expect(CALENDAR_TOOLS.map(t => t.name)).toEqual([
      'calendar_list_events', 'calendar_get_event', 'calendar_create_event',
      'calendar_list_calendars', 'calendar_check_availability']);
    for (const t of CALENDAR_TOOLS) {
      expect(t.revision).toBe('google-calendar.v2');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(t.inputSchema.properties)).toEqual(Object.keys(calendarInputSchemas[t.name].shape));
      const shape: Record<string, z.ZodTypeAny> = calendarInputSchemas[t.name].shape;
      expect(t.inputSchema.required).toEqual(Object.entries(shape).filter(([, schema]) => !schema.isOptional())
        .map(([name]) => name));
      for (const [key, rawProperty] of Object.entries(t.inputSchema.properties)) {
        const property: Record<string, unknown> = rawProperty;
        expect(shape[key].isOptional()).toBe(!t.inputSchema.required.includes(key));
        const wrongTypes = property.type === 'string' ? [null, true, 4, [], {}]
          : property.type === 'integer' ? [null, true, '1', [], {}, 1.5] : [null, true, 4, 'x', {}];
        for (const value of wrongTypes) expect(shape[key]!.safeParse(value).success).toBe(false);
        if (property.type === 'string') {
          const min = Number(property.minLength), max = Number(property.maxLength);
          expect(shape[key].safeParse('x'.repeat(min)).success).toBe(true);
          expect(shape[key].safeParse('x'.repeat(max)).success).toBe(true);
          expect(shape[key].safeParse('x'.repeat(max + 1)).success).toBe(false);
          if (min > 0) expect(shape[key].safeParse('').success).toBe(false);
          for (const value of [null, true, 4, [], {}]) expect(shape[key].safeParse(value).success).toBe(false);
        } else if (property.type === 'array') {
          const min = Number(property.minItems), max = Number(property.maxItems);
          expect(shape[key].safeParse(Array.from({ length: min }, (_, i) => `c${i}`)).success).toBe(true);
          expect(shape[key].safeParse(Array.from({ length: max }, (_, i) => `c${i}`)).success).toBe(true);
          expect(shape[key].safeParse(Array.from({ length: max + 1 }, (_, i) => `c${i}`)).success).toBe(false);
          if (min > 0) expect(shape[key].safeParse([]).success).toBe(false);
          if (property.uniqueItems) {
            expect(shape[key].safeParse(['dup', 'dup']).success).toBe(false);
          }
          const member = property.items as Record<string, unknown>;
          expect(member.type).toBe('string');
          expect(member.minLength).toBeGreaterThan(0);
          const maxLength = Number(member.maxLength);
          expect(shape[key].safeParse(['']).success).toBe(false);
          expect(shape[key].safeParse(['x'.repeat(maxLength)]).success).toBe(true);
          expect(shape[key].safeParse(['x'.repeat(maxLength + 1)]).success).toBe(false);
          for (const value of [null, 4, {}, []]) expect(shape[key].safeParse([value]).success).toBe(false);
        } else {
          expect(shape[key].safeParse(property.minimum).success).toBe(true);
          expect(shape[key].safeParse(property.maximum).success).toBe(true);
          expect(shape[key].safeParse(Number(property.maximum) + 1).success).toBe(false);
          for (const value of [null, true, '1', [], {}, 1.5]) expect(shape[key].safeParse(value).success).toBe(false);
        }
      }
      const validRequired = Object.fromEntries(t.inputSchema.required.map(name => {
        const property = t.inputSchema.properties[name] as Record<string, unknown>;
        return [name, property.type === 'integer' ? property.minimum
          : property.type === 'array' ? ['calendar'] : 'x'.repeat(Number(property.minLength ?? 1))];
      }));
      expect(calendarInputSchemas[t.name].safeParse(validRequired).success).toBe(true);
      expect(calendarInputSchemas[t.name].safeParse({ ...validRequired, accessToken: 'reserved' }).success).toBe(false);
      expect(calendarInputSchemas[t.name].safeParse({ ...validRequired, extraLabel: 'x' }).success).toBe(false);
    }
    expect(calendarInputSchemas.calendar_create_event.parse(create)).toEqual(create);
    for (const key of forbiddenCalendarKeys) {
      expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, [key]: 'override' }).success).toBe(false);
    }
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, extraLabel: 'x' }).success).toBe(false);
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, summary: 'x'.repeat(201) }).success).toBe(false);
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, description: 'x'.repeat(2001) }).success).toBe(false);
    expect(calendarInputSchemas.calendar_create_event.safeParse({ ...create, location: 'x'.repeat(501) }).success).toBe(false);
    const list = { timeMin: create.start, timeMax: create.end, maxResults: 20 };
    expect(calendarInputSchemas.calendar_list_events.safeParse(list).success).toBe(true);
    for (const maxResults of [0, 21, 1.5, '20', null, true, [], {}]) {
      expect(calendarInputSchemas.calendar_list_events.safeParse({ ...list, maxResults }).success).toBe(false);
    }
    expect(calendarInputSchemas.calendar_list_events.safeParse({ ...list, maxResults: 1 }).success).toBe(true);
    expect(calendarInputSchemas.calendar_list_events.safeParse({ ...list, maxResults: 20 }).success).toBe(true);
    expect(calendarInputSchemas.calendar_list_calendars.safeParse({ pageToken: '' }).success).toBe(false);
    expect(calendarInputSchemas.calendar_list_calendars.safeParse({ pageToken: 'x'.repeat(2048) }).success).toBe(true);
    expect(calendarInputSchemas.calendar_list_calendars.safeParse({ pageToken: 'x'.repeat(2049) }).success).toBe(false);
    const ids = Array.from({ length: 100 }, (_, i) => `calendar-${i}`);
    expect(calendarInputSchemas.calendar_check_availability.safeParse({ timeMin: 'x', timeMax: 'y',
      timeZone: 'z', calendarIds: ids.slice(0, 1) }).success).toBe(true);
    expect(calendarInputSchemas.calendar_check_availability.safeParse({ timeMin: 'x', timeMax: 'y',
      timeZone: 'z', calendarIds: ids }).success).toBe(true);
    expect(calendarInputSchemas.calendar_check_availability.safeParse({ timeMin: 'x', timeMax: 'y',
      timeZone: 'z', calendarIds: [...ids, 'calendar-100'] }).success).toBe(false);
    expect(calendarInputSchemas.calendar_check_availability.safeParse({ timeMin: 'x', timeMax: 'y',
      timeZone: 'z', calendarIds: ['calendar-1', 'calendar-1'] }).success).toBe(false);
  });
  it('bounds UTF-8 results, projection fields and list cardinality', () => {
    const event = { eventId: 'abcde', summary: 'Visit', start: create.start, end: create.end,
      timeZone: create.timeZone, status: 'confirmed', htmlLink: null };
    const result = { tool: 'calendar_list_events', events: Array.from({ length: 20 }, () => event),
      nextPageToken: null, truncated: false };
    expect(calendarResultSchema.safeParse(result).success).toBe(true);
    expect(calendarResultSchema.safeParse({ ...result, events: [...result.events, event] }).success).toBe(false);
    expect(calendarResultSchema.safeParse({ tool: 'calendar_get_event', event: { ...event, accessToken: 'secret' } }).success).toBe(false);
    const exact = { ...result, events: result.events.map(e => ({ ...e, description: '' })) };
    let remaining = 16384 - jsonBytes(exact);
    for (const projected of exact.events) {
      const fill = Math.min(2000, remaining); projected.description = 'x'.repeat(fill); remaining -= fill;
    }
    expect(remaining).toBe(0); expect(jsonBytes(exact)).toBe(16384);
    expect(calendarResultSchema.safeParse(exact).success).toBe(true);
    exact.events.find(e => e.description.length < 2000)!.description += 'x';
    expect(calendarResultSchema.safeParse(exact).success).toBe(false);
    const large = { ...result, events: result.events.map(e => ({ ...e, description: 'é'.repeat(2000) })) };
    expect(jsonBytes(large)).toBeGreaterThan(16384);
    expect(calendarResultSchema.safeParse(large).success).toBe(false);
  });
  it('does not enable all-day creation when all-day reads are supported', () => {
    expect(calendarInputSchemas.calendar_create_event.safeParse({ summary: 'Holiday',
      start: '2026-10-21', end: '2026-10-22', timeZone: 'Etc/UTC', allDay: true }).success).toBe(false);
  });
});
