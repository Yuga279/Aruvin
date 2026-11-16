/**
 * ============================================================================
 * FILE: calendar-intent.ts
 * LOCATION: backend/src/chat-runtime/calendar-intent.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic parsing and validation of accepted natural language calendar scheduling intents and proposal replies.
 *
 * ROLE IN PROJECT:
 *    Extracts unambiguous user scheduling requests directly from confirmed accepted user messages,
 *    preventing model-manufactured consent, and maps user replies to authoritative proposal decisions.
 *
 * KEY COMPONENTS:
 *    - readCalendarIntent: Validates accepted message against grammatical patterns and candidate events.
 *    - readCalendarReply: Bounded deterministic interpretation of user acceptance/rejection of proposals.
 *    - Distinct reply outcomes: 'ambiguous' engages the proposal without answering it, 'unrelated' does not.
 *    - calendarMissingFields: Maps the runtime field vocabulary onto the closed proposal enum.
 * ============================================================================
 */

import type { AttemptRecord } from '../contracts/attempt.js';
import type { MessageRecord } from '../contracts/message.js';
import type { CalendarCreateInput } from '../contracts/calendar-tools.js';
import type { CalendarProposalRecord, CalendarProposalMissingField } from '../contracts/calendar-authority.js';
import { key } from '../persistence/records.js';
import {
  compareCalendarTimes,
  parseCalendarTimestamp,
  validateCalendarCall,
} from '../plugins/google-calendar/tools-validation.js';

export type AcceptedCalendarIntent = {
  intentId: string;
  originatingTurnId: string;
  originatingAcceptedMessageId: string;
  originatingAttemptId: string;
  action: CalendarCreateInput;
  selector: string | null;
};

export type IntentInterpretation =
  | { outcome: 'complete'; intent: AcceptedCalendarIntent }
  | { outcome: 'confirmation' }
  | { outcome: 'details'; missing: readonly IntentMissingField[] }
  | { outcome: 'not-authorized' };

/**
 * The runtime's own vocabulary for a material field that is still missing.
 * It is mapped onto the closed proposal enum before it is published.
 */
export type IntentMissingField = 'summary' | 'date' | 'start' | 'end' | 'timeZone' | 'target';

/**
 * The runtime field vocabulary mapped onto the closed proposal enum.
 *
 * `summary` is the runtime's name for the event title, and `date` covers both
 * endpoints of the interval, so it maps onto `start` and `end`.
 *
 * ponytail: `duration` is part of the contract enum but the deterministic
 * scheduling grammar never expresses a duration-only gap. Upgrade through an
 * approved intent contract instead of inventing a value here.
 */
const MISSING_FIELD_MAP: Record<IntentMissingField, readonly CalendarProposalMissingField[]> = {
  summary: ['title'],
  date: ['start', 'end'],
  start: ['start'],
  end: ['end'],
  timeZone: ['timeZone'],
  target: ['target'],
};

/**
 * The still-missing material fields of one accepted request, in the closed
 * proposal enum. The result is distinct and bounded by the enum size.
 */
export function calendarMissingFields(missing: readonly IntentMissingField[]): CalendarProposalMissingField[] {
  const mapped = new Set<CalendarProposalMissingField>();
  for (const field of missing) for (const target of MISSING_FIELD_MAP[field]) mapped.add(target);
  return [...mapped];
}

/** The deterministic intent identity of one accepted message. */
export function calendarIntentId(message: MessageRecord): string {
  return key('calendar-intent', message.userId, message.sessionId, message.messageId);
}

export type ReplyInterpretation =
  | { decision: 'accept' | 'cancel'; choiceCalendarId: null }
  | { decision: 'select'; choiceCalendarId: string }
  | { decision: 'edit' | 'unrelated' | 'ambiguous'; choiceCalendarId: null };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const DATE = '(?:\\d{4}-\\d{2}-\\d{2}|[A-Za-z]+ \\d{1,2},? \\d{4})';
const TIME = '\\d{1,2}(?::\\d{2})?(?:\\s*[ap]m)?';
const ZONE = '(?:[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+|my configured time zone)';
const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})';
const VERB = '(?:(?:please|can you|could you)(?: please)?\\s+)?(?:schedule|create|add|book|put)\\s+';
const CREATE_REQUEST = new RegExp(`^${VERB}`, 'iu');
const TITLE = '(?:an? event (?:called|named) )?(?<summary>.+?)';
const CLOCKS = `(?<start>${TIME})\\s*(?:to|until|[-–])\\s*(?<end>${TIME})`;
const FIELDS = '(?:; description "(?<description>[^"\\r\\n]{1,2000})")?'
  + '(?:; location "(?<location>[^"\\r\\n]{1,500})")?';
const patterns = [
  new RegExp(`^${VERB}${TITLE} on (?<date>${DATE}) (?:from )?${CLOCKS} (?:in )?(?<zone>${ZONE})`
    + `(?: (?:on|in) (?:my |the )?(?<selector>.+?) calendar)?${FIELDS}[.!?]?$`, 'iu'),
  new RegExp(`^${VERB}${TITLE} to (?:my |the )?(?<selector>.+?) calendar on (?<date>${DATE}),? `
    + `(?:from )?${CLOCKS} (?:in )?(?<zone>${ZONE})${FIELDS}[.!?]?$`, 'iu'),
  new RegExp(`^${VERB}${TITLE} from (?<startStamp>${STAMP}) (?:to|until) (?<endStamp>${STAMP})`
    + ` (?:in )?(?<zone>${ZONE})(?: (?:on|in) (?:my |the )?(?<selector>.+?) calendar)?${FIELDS}[.!?]?$`, 'iu'),
  new RegExp(`^${VERB}${TITLE} on (?<startDate>${DATE}) from (?<start>${TIME}) (?:to|until) `
    + `(?<endDate>${DATE}) (?<end>${TIME}) (?:in )?(?<zone>${ZONE})`
    + `(?: (?:on|in) (?:my |the )?(?<selector>.+?) calendar)?${FIELDS}[.!?]?$`, 'iu'),
];

function civilDate(text: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text;
  const match = /^([A-Za-z]+) (\d{1,2}),? (\d{4})$/u.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLocaleLowerCase('en-US')) + 1;
  return month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}` : null;
}

function wallTime(text: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/iu.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function hasFold(value: NonNullable<ReturnType<typeof parseCalendarTimestamp>>, zone: string): boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const wall = (at: number) => {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(at))
      .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const utc = new Date(0);
    utc.setUTCFullYear(fields.year, fields.month - 1, fields.day);
    utc.setUTCHours(fields.hour, fields.minute, fields.second, 0);
    return utc.getTime();
  };
  const at = Number(value.epochSeconds * 1000n);
  const requestedWall = wall(at);
  // ponytail: at most 2879 minute-offset candidates per endpoint (the admitted
  // RFC3339 offset range); use a verified timezone-transition primitive if profiling requires it.
  for (let minutes = -1439; minutes <= 1439; minutes += 1) {
    const alternate = requestedWall - minutes * 60000;
    if (alternate !== at && wall(alternate) === requestedWall) return true;
  }
  return false;
}

// ponytail: the complete grammar still writes immediately. Any other accepted
// user message gets a Yes/Cancel preview of the model-proposed values, except
// explicit refusals. Upgrade through an approved intent contract if a follow-up
// should write without that preview.
export function readCalendarIntent(message: MessageRecord, attempt: AttemptRecord,
  candidate: CalendarCreateInput, trustedTimeZone: string): IntentInterpretation {
  if (message.role !== 'user' || (message.visibility === 'internal' && message.mode !== 'live')
    || message.completionStatus !== 'accepted'
    || message.userId !== attempt.userId || message.sessionId !== attempt.sessionId
    || message.turnId !== attempt.turnId || message.messageId !== attempt.causal.userMessageId) {
    return { outcome: 'not-authorized' };
  }
  const content = message.content.trim();
  const match = patterns.map(pattern => pattern.exec(content)).find(Boolean);
  if (!match?.groups && !CREATE_REQUEST.test(content)
    && /^(?:do not|don't|dont|no)\b/iu.test(content)) {
    return { outcome: 'not-authorized' };
  }
  // Reject unsupported requested effects rather than silently dropping them.
  if (/\b(?:with attendees|invite attendees|recurring|every (?:day|week|month)|all[- ]day)\b/iu.test(content)) {
    return { outcome: 'not-authorized' };
  }
  try { validateCalendarCall({ name: 'calendar_create_event', arguments: candidate }); }
  catch { return { outcome: 'details', missing: ['date', 'start', 'end', 'timeZone'] }; }
  if (!match?.groups) return { outcome: 'confirmation' };
  const fields = match.groups;
  const title = fields.summary.replace(/^"([^"]+)"$/u, '$1');
  if (fields.selector && fields.selector.length > 1024) return { outcome: 'details', missing: ['target'] };
  const start = parseCalendarTimestamp(candidate.start);
  const end = parseCalendarTimestamp(candidate.end);
  const date = fields.date ? civilDate(fields.date) : null;
  const civil = (value: NonNullable<typeof start>) => `${String(value.year).padStart(4, '0')}`
    + `-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  const time = (value: NonNullable<typeof start>) => `${String(value.hour).padStart(2, '0')}`
    + `:${String(value.minute).padStart(2, '0')}`;
  const zone = fields.zone.toLocaleLowerCase('en-US') === 'my configured time zone'
    ? trustedTimeZone : fields.zone;
  if (zone !== candidate.timeZone) return { outcome: 'details', missing: ['timeZone'] };
  const explicitStart = fields.startStamp ? parseCalendarTimestamp(fields.startStamp) : null;
  const explicitEnd = fields.endStamp ? parseCalendarTimestamp(fields.endStamp) : null;
  const timesMatch = start !== null && end !== null && (fields.startStamp
    ? explicitStart !== null && explicitEnd !== null
      && compareCalendarTimes(explicitStart, start) === 0 && compareCalendarTimes(explicitEnd, end) === 0
    : civil(start) === (fields.startDate ? civilDate(fields.startDate) : date)
      && civil(end) === (fields.endDate ? civilDate(fields.endDate) : date)
      && time(start) === wallTime(fields.start) && time(end) === wallTime(fields.end)
      && start.second === 0 && end.second === 0 && /^0*$/u.test(start.fraction) && /^0*$/u.test(end.fraction)
      && !hasFold(start, zone) && !hasFold(end, zone));
  if (!timesMatch || zone !== candidate.timeZone || title !== candidate.summary
    || (fields.description ?? undefined) !== candidate.description
    || (fields.location ?? undefined) !== candidate.location) {
    return { outcome: 'details', missing: ['summary', 'date', 'start', 'end', 'timeZone'] };
  }
  const { calendarId: untrustedSelector, ...action } = candidate;
  void untrustedSelector;
  return { outcome: 'complete', intent: {
    intentId: calendarIntentId(message),
    originatingTurnId: message.turnId, originatingAcceptedMessageId: message.messageId,
    originatingAttemptId: attempt.attemptId, action, selector: fields.selector?.trim() ?? null,
  } };
}

/**
 * A reply that engages the proposal without deciding it. The runtime asks again
 * instead of answering it as ordinary chat, so an uncertain answer never
 * silently leaves the proposal pending.
 *
 * ponytail: a bounded word list and the question mark. The ceiling is that a
 * fluent hedge ("I will think about it") is read as ordinary chat; upgrade
 * through a separately approved reply contract rather than a language model.
 */
const UNCERTAIN_REPLY = /^(?:maybe|perhaps|possibly|maybe so|perhaps so|i guess|i guess so|i think so|not sure|unsure|undecided|idk|whatever|hmm+|hm+)$/u;

export function readCalendarReply(content: string, proposal: CalendarProposalRecord): ReplyInterpretation {
  const raw = content.trim();
  const normalized = raw.toLocaleLowerCase('en-US').replace(/[.!?]+$/u, '').trim();
  if (/^(?:no|cancel|stop|do not create it|don't create it)$/u.test(normalized)) {
    return { decision: 'cancel', choiceCalendarId: null };
  }
  if (proposal.purpose !== 'selection'
    && /^(?:yes(?:,? (?:please|go ahead))?|yep|yeah|sure|ok|okay|alright|go ahead|create it anyway|i accept the conflict|i accept the incomplete coverage)$/u.test(normalized)) {
    return { decision: 'accept', choiceCalendarId: null };
  }
  // "No, just create it" declines the alternative, not the disclosed event.
  // ponytail: only this whole explicit command overrides disclosed conditions;
  // questions, negated commands and appended qualifications never grant consent.
  if (proposal.purpose !== 'selection' && !raw.includes('?')
    && /^(?:no,?\s+)?just\s+create\s+(?:it|the\s+event)(?:\s+anyway)?$/u.test(normalized)) {
    return { decision: 'accept', choiceCalendarId: null };
  }
  // A plain create reply approves disclosed event details, not an override of
  // a conflict or incomplete availability coverage.
  if (proposal.purpose === 'details'
    && /^(?:please )?(?:create|schedule|add|book) (?:it|the event)$/u.test(normalized)) {
    return { decision: 'accept', choiceCalendarId: null };
  }
  if (proposal.purpose === 'selection') {
    for (const cand of proposal.candidates) {
      if (normalized === cand.target.calendarId.toLowerCase()
        || (cand.target.calendarLabel && normalized === cand.target.calendarLabel.toLowerCase())) {
        return { decision: 'select', choiceCalendarId: cand.target.calendarId };
      }
    }
    const ordinalMap: Record<string, number> = {
      '1': 0, 'first': 0, 'one': 0,
      '2': 1, 'second': 1, 'two': 1,
      '3': 2, 'third': 2, 'three': 2,
    };
    // A natural choice may name the option ("use the second one"), not repeat
    // the calendar name.
    const ordinalKey = normalized
      .replace(/^yes,?\s+/u, '')
      .replace(/^(?:use|pick|choose|select|schedule on)\s+/u, '')
      .replace(/^the\s+/u, '')
      .replace(/\s+one$/u, '');
    const ordinal = ordinalMap[ordinalKey];
    if (ordinal !== undefined && proposal.candidates[ordinal]) {
      return { decision: 'select', choiceCalendarId: proposal.candidates[ordinal].target.calendarId };
    }
  }
  if (/\b(?:make it|change|at \d|on \d|instead)\b/u.test(normalized)) {
    return { decision: 'edit', choiceCalendarId: null };
  }
  // Unrelated questions are ordinary chat, not scheduling confirmations.
  // ponytail: recognize only these explicit proposal follow-ups; other wording
  // stays non-authorizing ordinary chat rather than being guessed as consent.
  if (UNCERTAIN_REPLY.test(normalized)
    || /^(?:are you sure|why(?: not)?|what if(?: .*)?|is that (?:okay|ok|safe)|should i (?:go ahead|create it))$/u.test(normalized)) {
    return { decision: 'ambiguous', choiceCalendarId: null };
  }
  return { decision: 'unrelated', choiceCalendarId: null };
}
