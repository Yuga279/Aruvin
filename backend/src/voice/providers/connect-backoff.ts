/**
 * ============================================================================
 * FILE: connect-backoff.ts
 * LOCATION: backend/src/voice/providers/connect-backoff.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Exponential backoff retry helper for fresh live voice provider connections.
 *
 * ROLE IN PROJECT:
 *    Provides bounded retry with jitter (up to 5 attempts, ≤10s deadline)
 *    for live STT/TTS handshakes, preventing established stream replay.
 *
 * KEY COMPONENTS:
 *    - connectWithBackoff: Retries fresh connection attempts with exponential backoff & jitter
 * ============================================================================
 */

import { setTimeout as delay } from 'node:timers/promises';
import { ProviderFault } from './provider-link.js';

export async function connectWithBackoff<T>(operation: (signal: AbortSignal) => Promise<T>,
  options: { signal: AbortSignal; deadlineMs: number; random?: () => number }): Promise<T> {
  const controller = new AbortController();
  const ended = new ProviderFault('VOICE_RECONNECT_TIMEOUT', 'return_to_chat');
  const cancelled = new ProviderFault('VOICE_SESSION_ENDED', 'none', false);
  let timedOut = false;
  let connected = false;
  const abort = () => controller.abort();
  if (options.signal.aborted) throw cancelled;
  options.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(10000, options.deadlineMs));
  let stopReject: ((error: ProviderFault) => void) | undefined;
  const stopped = new Promise<never>((_, reject) => { stopReject = reject; });
  const onStop = () => stopReject?.(timedOut ? ended : cancelled);
  controller.signal.addEventListener('abort', onStop, { once: true });
  try {
    return await Promise.race([stopped, (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (controller.signal.aborted) throw timedOut ? ended : cancelled;
        try { const connection = await operation(controller.signal); connected = true; return connection; }
        catch (error) {
          if (controller.signal.aborted) throw timedOut ? ended : cancelled;
          if (!(error instanceof ProviderFault) || !error.fault.recoverable ||
            !['STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_CONNECT_TIMEOUT', 'VOICE_PROVIDER_RATE_LIMITED'].includes(error.fault.code)) throw error;
          if (attempt === 4) throw ended;
          const random = Math.max(0, Math.min(1, (options.random ?? Math.random)()));
          const backoff = Math.min(2000, 250 * 2 ** attempt);
          await delay(Math.floor(backoff * (1 + random)), undefined, { signal: controller.signal });
        }
      }
      throw ended;
    })()]);
  } finally {
    clearTimeout(timer);
    if (!connected) { controller.abort(); options.signal.removeEventListener('abort', abort); }
    controller.signal.removeEventListener('abort', onStop);
  }
}
