import { AppError } from '../platform/errors/app-error.js';
import { TRANSPORT_LIMITS } from './policy.js';
import { object } from './faults.js';
import type { SkillNativeDefinition } from '../contracts/calendar-tools.js';
import type { CalendarLimits } from '../contracts/calendar-policy.js';
import { validateCalendarCandidate, type CandidateCall, type ValidatedCandidate } from './calendar-validation.js';
import type { DiagnosticSink } from '../chat-runtime/ports.js';

const ENTRY_OVERHEAD = 64;
const provider = () => new AppError('PROVIDER_ERROR', 'The response stream was invalid.', false);
const overflow = () => new AppError('STORAGE_BUDGET_EXCEEDED', 'The response exceeded its storage limit.', false);

export type AssembledSkillCandidate =
  | Exclude<ValidatedCandidate, { kind: 'valid' }>
  | (Extract<ValidatedCandidate, { kind: 'valid' }> & { assistantContent: string | null });

export class CalendarStreamAssembly {
  private text = '';
  private contentSeen = false;
  private readonly calls = new Map<number, CandidateCall>();
  private readonly unindexed: CandidateCall[] = [];
  private terminal: string | null = null;
  private envelopeInvalid = false;
  private retainedBytes = 0;
  private role: string | null = null;

  constructor(private allowed: readonly SkillNativeDefinition[], private limits: CalendarLimits,
    private diagnostic?: DiagnosticSink) {}

  private charge(bytes: number): void {
    this.retainedBytes += bytes;
    if (this.retainedBytes > TRANSPORT_LIMITS.streamBytes) throw overflow();
  }

  private candidate(index: number, id: string | null, type: string | null, name: string, args: string, invalid: boolean): CandidateCall {
    return { index, id, type, name, arguments: args, envelopeInvalid: invalid };
  }

  private mergeFragment(fragment: unknown): boolean {
    const item = object(fragment);
    const index = item.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || !Number.isSafeInteger(index)) {
      this.envelopeInvalid = true;
      const name = typeof object(item.function).name === 'string' ? String(object(item.function).name) : '';
      const args = typeof object(item.function).arguments === 'string' ? String(object(item.function).arguments) : '';
      this.charge(ENTRY_OVERHEAD + Buffer.byteLength(name + args, 'utf8'));
      this.unindexed.push(this.candidate(-1, typeof item.id === 'string' ? item.id : null,
        typeof item.type === 'string' ? item.type : null, name, args, true));
      return name.length > 0 || args.length > 0;
    }
    let current = this.calls.get(index);
    if (!current) {
      this.charge(ENTRY_OVERHEAD);
      current = this.candidate(index, null, null, '', '', false);
      this.calls.set(index, current);
    }
    let meaningful = false;
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 128) {
        this.envelopeInvalid = true;
        current.envelopeInvalid = true;
      } else if (current.id === null) current.id = item.id;
      else if (current.id !== item.id) {
        this.envelopeInvalid = true;
        current.envelopeInvalid = true;
      }
      for (const [otherIndex, other] of this.calls) {
        if (otherIndex !== index && other.id && current.id && other.id === current.id) this.envelopeInvalid = true;
      }
    }
    if (item.type !== undefined) {
      if (item.type !== 'function') {
        this.envelopeInvalid = true;
        current.envelopeInvalid = true;
      } else if (current.type === null) current.type = 'function';
      else if (current.type !== item.type) this.envelopeInvalid = true;
    }
    const fn = item.function === undefined ? {} : object(item.function);
    if (item.function !== undefined && (typeof item.function !== 'object' || item.function === null || Array.isArray(item.function))) {
      this.envelopeInvalid = true;
      current.envelopeInvalid = true;
      return meaningful;
    }
    if (fn.name !== undefined) {
      if (typeof fn.name !== 'string') {
        this.envelopeInvalid = true;
        current.envelopeInvalid = true;
      } else {
        this.charge(Buffer.byteLength(fn.name, 'utf8'));
        current.name += fn.name;
        if (current.name.length > 64) {
          current.name = current.name.slice(0, 64);
          this.envelopeInvalid = true;
          current.envelopeInvalid = true;
        }
        meaningful = meaningful || fn.name.length > 0;
      }
    }
    if (fn.arguments !== undefined) {
      if (typeof fn.arguments !== 'string') {
        this.envelopeInvalid = true;
        current.envelopeInvalid = true;
      } else {
        this.charge(Buffer.byteLength(fn.arguments, 'utf8'));
        current.arguments += fn.arguments;
        if (Buffer.byteLength(current.arguments, 'utf8') > this.limits.argumentBytes) throw overflow();
        meaningful = meaningful || fn.arguments.length > 0;
      }
    }
    return meaningful;
  }

  push(raw: unknown): { text: string | null; meaningfulOutput: boolean } {
    const frame = object(raw);
    const usageOnly = frame.usage !== undefined && (frame.choices === undefined || (Array.isArray(frame.choices) && frame.choices.length === 0));
    if (usageOnly) {
      if (Array.isArray(frame.choices) && frame.choices.length === 1) {
        /* fall through */
      } else {
        return { text: null, meaningfulOutput: false };
      }
    }
    if (frame.choices === undefined && frame.usage !== undefined) return { text: null, meaningfulOutput: false };
    if (!Array.isArray(frame.choices)) throw provider();
    if (frame.choices.length > 1) throw provider();
    if (frame.choices.length === 0) return { text: null, meaningfulOutput: false };
    const choice = object(frame.choices[0]);
    if (choice.index !== undefined && choice.index !== 0) throw provider();
    const delta = choice.delta === undefined ? {} : object(choice.delta);
    if (choice.delta !== undefined && (typeof choice.delta !== 'object' || choice.delta === null || Array.isArray(choice.delta))) throw provider();
    if (delta.role !== undefined) {
      if (delta.role !== 'assistant') throw provider();
      if (this.role && this.role !== delta.role) throw provider();
      this.role = 'assistant';
    }
    const finish = choice.finish_reason === undefined || choice.finish_reason === null ? null : String(choice.finish_reason);
    const content = delta.content;
    if (typeof content === 'string') this.contentSeen = true;
    const hasContent = content !== undefined && content !== null && !(typeof content === 'string' && content.length === 0);
    const hasCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
    const hasLegacy = delta.function_call !== undefined;
    if (this.terminal && (hasContent || hasCalls || hasLegacy)) throw provider();
    if (this.terminal && finish && finish !== this.terminal) throw provider();
    let text: string | null = null;
    let meaningful = false;
    if (content !== undefined && content !== null) {
      if (typeof content !== 'string') throw provider();
      if (content.length) {
        if (this.text.length + content.length > TRANSPORT_LIMITS.outputChars) throw overflow();
        this.charge(Buffer.byteLength(content, 'utf8'));
        this.text += content;
        text = content;
        meaningful = true;
      }
    }
    if (hasLegacy) {
      this.envelopeInvalid = true;
      meaningful = true;
    }
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls)) throw provider();
      for (const fragment of delta.tool_calls) {
        if (this.mergeFragment(fragment)) meaningful = true;
      }
    }
    if (finish) {
      if (!['stop', 'length', 'tool_calls'].includes(finish)) throw provider();
      this.terminal = finish;
    }
    return { text, meaningfulOutput: meaningful };
  }

  finish(): { kind: 'text'; content: string; truncated: boolean } | AssembledSkillCandidate {
    if (!this.terminal) throw provider();
    const calls = [...this.calls.values()].sort((a, b) => a.index - b.index).concat(this.unindexed);
    if (calls.length === 0 && (this.terminal === 'stop' || this.terminal === 'length')) {
      return { kind: 'text', content: this.text, truncated: this.terminal === 'length' };
    }
    const batchCalls = calls.length ? calls : [this.candidate(0, null, null, '', '', true)];
    const validated = validateCalendarCandidate({
      calls: batchCalls,
      terminal: this.terminal,
      envelopeInvalid: this.envelopeInvalid || batchCalls.some(call => call.envelopeInvalid),
    }, this.allowed, this.limits, this.diagnostic);
    return validated.kind === 'valid' ? { ...validated, assistantContent: this.contentSeen ? this.text : null } : validated;
  }
}
