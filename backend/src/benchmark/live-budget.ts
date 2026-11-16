/**
 * ============================================================================
 * FILE: live-budget.ts
 * LOCATION: backend/src/benchmark/live-budget.ts
 * PURPOSE: Bound provider egress during the approved WebSocket baseline only.
 * ROLE IN PROJECT: Injected benchmark guard; never part of ordinary app startup.
 * KEY COMPONENTS: LiveBudget HTTP, speech-byte and lifetime ceilings.
 * ============================================================================
 */
import type { SocketFactory, ProviderSocket } from '../voice/providers/provider-link.js';

export class LiveBudget {
  private readonly controller = new AbortController();
  private readonly active = new Set<ProviderSocket>();
  private started: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private requests = 0;
  private speechBytes = 0;
  private inputBytes = 0;
  private socketCount = 0;
  private denial: string | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}
  private deny(): never {
    this.denial = 'LIVE_BUDGET_DENIED';
    this.stop();
    throw new Error('LIVE_BUDGET_DENIED');
  }
  private check(paid = false) {
    if (this.controller.signal.aborted || this.started !== null && this.now() - this.started >= 900000) this.deny();
    if (paid && this.started === null) {
      this.started = this.now();
      this.timer = setTimeout(() => this.stop(), 900000);
      this.timer.unref();
    }
  }
  fetch(fetcher: typeof fetch): typeof fetch {
    return async (input, init) => {
      this.check();
      const u = new URL(input instanceof Request ? input.url : String(input));
      if (u.origin !== 'https://openrouter.ai') this.deny();
      const method = init?.method ?? 'GET';
      if (method === 'POST' && u.pathname === '/api/v1/chat/completions') {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        const estimated = Array.isArray(body.messages) ? body.messages.reduce((n: number, m: { content: unknown }) =>
          n + (typeof m.content === 'string' ? Buffer.byteLength(m.content) + 32 : 60001), 64) : 60001;
        const output = body.max_tokens ?? body.max_completion_tokens;
        if (body.model !== 'anthropic/claude-haiku-5.5' || !Number.isSafeInteger(output) || output < 1 || output > 6000
          || estimated + output + 1024 > 60000 || body.tools?.length || body.tool_choice
          || body.plugins?.some((p: { enabled: unknown }) => p.enabled !== false) || this.requests >= 16) this.deny();
        this.check(true); this.requests++;
      } else if (method !== 'GET' || !['/api/v1/models', '/api/v1/generation'].includes(u.pathname)) this.deny();
      return fetcher(input, { ...init, redirect: 'error', signal: AbortSignal.any([
        this.controller.signal, ...(init?.signal ? [init.signal] : []),
      ]) });
    };
  }
  sockets(factory: SocketFactory): SocketFactory {
    return (url, headers) => {
      this.check(true);
      const tts = url.pathname === '/v2/speak';
      if (url.origin !== 'wss://api.deepgram.com' || !(tts && url.searchParams.get('model') === 'flux-haley-en'
        || url.pathname === '/v2/listen' && url.searchParams.get('model') === 'flux-general-en')
        || this.socketCount >= 32) this.deny();
      this.socketCount++;
      const socket = factory(url, headers), send = socket.send.bind(socket);
      this.active.add(socket);
      socket.once('close', () => this.active.delete(socket));
      socket.send = (data, callback) => {
        try {
          this.check();
          if (typeof data === 'string') {
            const m = JSON.parse(data);
            if (m.type === 'Speak') {
              if (!tts || typeof m.text !== 'string') this.deny();
              const bytes = Buffer.byteLength(m.text);
              if (this.speechBytes + bytes > 4000) this.deny();
              this.speechBytes += bytes;
            } else if (!['Flush', 'Close', 'CloseStream', 'ForceEndTurn', 'Interrupt'].includes(m.type)) this.deny();
          } else {
            if (tts || this.inputBytes + data.byteLength > 60000 * 32) this.deny();
            this.inputBytes += data.byteLength;
          }
        } catch { callback(new Error('LIVE_BUDGET_DENIED')); return; }
        send(data, callback);
      };
      return socket;
    };
  }
  snapshot() {
    return { modelRequests: this.requests, ttsUtf8Bytes: this.speechBytes, inputAudioMs: this.inputBytes / 32,
      providerSockets: this.socketCount, activeProviderSockets: this.active.size, denial: this.denial,
      activeElapsedMs: this.started === null ? 0 : this.now() - this.started,
      // Highest catalogue pricing tier, even though the admitted context stays below its threshold;
      // 4000 UTF-8 bytes upper-bound billable characters. 10% reserve; no promo/free-credit deduction.
      conservativeMaximumUsd: (16 * (60000 * 0.0000005 + 6000 * 0.0000025) + 4000 * 0.045 / 1000 + 0.0077) * 1.1 };
  }
  stop() {
    clearTimeout(this.timer);
    this.controller.abort();
    for (const socket of this.active) socket.terminate();
  }
}
