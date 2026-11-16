/**
 * ============================================================================
 * FILE: stream-delta-coalescer.ts
 * LOCATION: frontend/src/features/chat/state/stream-delta-coalescer.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Coalesce high-frequency SSE text stream deltas before React state dispatch.
 *
 * ROLE IN PROJECT:
 *    Buffers rapid token arrivals at the presentation boundary to dispatch
 *    STREAM_DELTA at most once per animation frame or bounded timeout, preventing
 *    excessive React renders while strictly preserving ordering, terminal text,
 *    reset semantics, and turn/session isolation.
 *
 * KEY COMPONENTS:
 *    - createDefaultStreamScheduler: rAF scheduler with bounded timeout fallback.
 *    - StreamDeltaCoalescer: State boundary buffer, reset handler, and flush orchestrator.
 * ============================================================================
 */

export interface StreamScheduler {
  schedule(callback: () => void): () => void;
}

export interface StreamDeltaPayload {
  text: string;
  reset?: boolean;
}

export interface TurnContext {
  sessionId?: string | null;
  turnId?: string | null;
  attemptId?: string | null;
}

export interface StreamDeltaCoalescerOptions {
  onFlush: (payload: StreamDeltaPayload) => void;
  scheduler?: StreamScheduler;
}

export function createDefaultStreamScheduler(options?: {
  maxDelayMs?: number;
}): StreamScheduler {
  const hasRaf = typeof requestAnimationFrame === 'function';
  const defaultDelay = hasRaf ? 32 : 16;
  const maxDelayMs = options?.maxDelayMs ?? defaultDelay;

  return {
    schedule(callback: () => void) {
      let cancelled = false;
      let rafId: number | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const trigger = () => {
        if (cancelled) return;
        cancelled = true;
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        callback();
      };

      if (hasRaf) {
        rafId = requestAnimationFrame(() => {
          trigger();
        });
      }

      // Bounded background-tab timeout fallback.
      // If requestAnimationFrame is throttled or paused (e.g. background tab)
      // or if requestAnimationFrame is not available, setTimeout guarantees bounded delay.
      timeoutId = setTimeout(() => {
        trigger();
      }, maxDelayMs);

      return () => {
        cancelled = true;
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
    },
  };
}

export class StreamDeltaCoalescer {
  private onFlush: (payload: StreamDeltaPayload) => void;
  private scheduler: StreamScheduler;
  private bufferedText = '';
  private hasReset = false;
  private isScheduled = false;
  private cancelScheduled: (() => void) | null = null;
  private activeContext: TurnContext | null = null;
  private aborted = false;

  constructor(options: StreamDeltaCoalescerOptions) {
    this.onFlush = options.onFlush;
    this.scheduler = options.scheduler ?? createDefaultStreamScheduler();
  }

  attachTurn(context: TurnContext): void {
    this.cancel();
    this.activeContext = { ...context };
    this.aborted = false;
  }

  bufferDelta(text: string, reset?: boolean, context?: TurnContext): void {
    if (this.aborted) return;
    if (context && this.activeContext) {
      if (
        (context.turnId && context.turnId !== this.activeContext.turnId) ||
        (context.attemptId && context.attemptId !== this.activeContext.attemptId) ||
        (context.sessionId && context.sessionId !== this.activeContext.sessionId)
      ) {
        return;
      }
    }

    if (reset) {
      this.bufferedText = text;
      this.hasReset = true;
    } else {
      this.bufferedText += text;
    }

    if (!this.isScheduled) {
      this.isScheduled = true;
      this.cancelScheduled = this.scheduler.schedule(() => {
        this.isScheduled = false;
        this.cancelScheduled = null;
        this.performFlush();
      });
    }
  }

  flush(): void {
    if (this.cancelScheduled) {
      this.cancelScheduled();
      this.cancelScheduled = null;
    }
    this.isScheduled = false;
    this.performFlush();
  }

  /**
   * Take buffered text without dispatching STREAM_DELTA. Completed/error
   * handlers must apply this in the same action: React batches a separate
   * STREAM_DELTA with the terminal action and the terminal reducer still
   * sees empty streamText.
   */
  drain(): { text: string; reset: boolean } {
    if (this.cancelScheduled) {
      this.cancelScheduled();
      this.cancelScheduled = null;
    }
    this.isScheduled = false;
    const text = this.bufferedText;
    const reset = this.hasReset;
    this.bufferedText = '';
    this.hasReset = false;
    return { text, reset };
  }

  cancel(): void {
    if (this.cancelScheduled) {
      this.cancelScheduled();
      this.cancelScheduled = null;
    }
    this.isScheduled = false;
    this.bufferedText = '';
    this.hasReset = false;
    this.aborted = true;
    this.activeContext = null;
  }

  hasPending(): boolean {
    return this.bufferedText.length > 0 || this.hasReset;
  }

  private performFlush(): void {
    if (this.aborted) return;
    if (this.bufferedText.length === 0 && !this.hasReset) return;

    const payload: StreamDeltaPayload = {
      text: this.bufferedText,
      ...(this.hasReset ? { reset: true } : {}),
    };
    this.bufferedText = '';
    this.hasReset = false;
    this.onFlush(payload);
  }
}
