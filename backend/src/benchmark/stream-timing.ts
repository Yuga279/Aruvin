/**
 * ============================================================================
 * FILE: stream-timing.ts
 * LOCATION: backend/src/benchmark/stream-timing.ts
 * PURPOSE: Observe model wire latency before persistence and application delivery.
 * ROLE IN PROJECT: Shared by text and Calendar transports; never retains payloads.
 * KEY COMPONENTS: StreamTiming: one bounded timing record per HTTP dispatch.
 * ============================================================================
 */
import { diagnose, type DiagnosticSink } from '../chat-runtime/ports.js';

const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const tokens = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

export class StreamTiming {
  private readonly started: number;
  private event = false;
  private output = false;
  private text = false;
  private ended = false;
  private promptTokens?: number;
  private completionTokens?: number;
  constructor(private sink: DiagnosticSink | undefined,
    private scope: Record<string, unknown>, private now: () => number = () => performance.now()) {
    this.started = now();
  }
  private emit(stage: string, fields: Record<string, unknown> = {}) {
    diagnose(this.sink, { ...this.scope, stage, provider: 'openrouter',
      durationMs: Math.max(0, this.now() - this.started), ...fields });
  }
  frame(raw: unknown) {
    if (this.ended) return;
    if (!this.event) { this.event = true; this.emit('model-first-event'); }
    const top = object(raw), usage = object(top.usage);
    this.promptTokens = tokens(usage.prompt_tokens) ?? this.promptTokens;
    this.completionTokens = tokens(usage.completion_tokens) ?? this.completionTokens;
    const delta = object(object(Array.isArray(top.choices) ? top.choices[0] : undefined).delta);
    const text = typeof delta.content === 'string' && delta.content.length > 0;
    const tool = Array.isArray(delta.tool_calls) && delta.tool_calls.some(v => {
      const fn = object(object(v).function);
      return (typeof fn.name === 'string' && fn.name.length > 0)
        || (typeof fn.arguments === 'string' && fn.arguments.length > 0);
    });
    if (!this.output && (text || tool)) { this.output = true; this.emit('model-first-output'); }
    if (!this.text && text) { this.text = true; this.emit('model-first-text'); }
  }
  end(ok: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.emit('model-stream-end', { state: ok ? 'ok' : 'error',
      promptTokens: this.promptTokens, completionTokens: this.completionTokens });
  }
}
