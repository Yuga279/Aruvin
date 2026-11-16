/**
 * ============================================================================
 * FILE: voice-runner.ts
 * LOCATION: backend/src/benchmark/voice-runner.ts
 * PURPOSE: Replay consented PCM through the real voice WebSocket protocol.
 * ROLE IN PROJECT: Headless latency client with explicitly simulated playback.
 * KEY COMPONENTS: runVoice: real-time input pacing and bounded output drainage.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { INPUT_AUDIO, isCreateVoiceSessionResponse, parseVoiceControl,
  type VoiceClientPayload, type VoiceResponseRef } from '../contracts/voice-wire.js';
import { encodeVoiceAudio, decodeVoiceAudio } from '../contracts/voice-audio.js';
import type { BenchmarkConfig, WireResult } from './runner.js';

export async function runVoice(config: BenchmarkConfig, pcm: Uint8Array, authorization?: string,
  confirmDelivery?: (wire: WireResult, signal: AbortSignal) => Promise<boolean>): Promise<WireResult> {
  if (!config.speechEndMs || pcm.length % 2 || pcm.length < (config.speechEndMs + 1000) * 32
    || pcm.length > 65_000 * 32) throw new Error('INVALID_BENCHMARK_PCM');
  const started = performance.now(), signal = AbortSignal.timeout(config.timeoutMs);
  const headers: Record<string, string> = { Origin: config.origin, 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  const result: WireResult = { durationMs: 0, firstTextMs: null, acceptanceMs: null,
    firstAudioMs: null, speechEndToFirstAudioMs: null, inputAudioMs: 0, outcome: 'failed' };
  let socket: WebSocket | undefined, timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  try {
    const response = await fetch(`${config.baseUrl}/voice/sessions`, { method: 'POST', headers,
      body: JSON.stringify({ protocolVersion: 1, mode: 'live', conversationId: null,
        locale: 'en-US', idempotencyKey: randomUUID() }), signal, redirect: 'error' });
    if (response.status !== 201) { result.outcome = `http-${response.status}`; await response.body?.cancel(); return result; }
    const session: unknown = await response.json();
    if (!isCreateVoiceSessionResponse(session)) throw new Error('INVALID_VOICE_RESPONSE');
    result.voiceSessionId = session.sessionId;
    result.acceptanceMs = performance.now() - started;
    if (config.transport === 'webrtc') {
      if (!session.livekit) {
        result.failureCode = 'BENCHMARK_TRANSPORT_MISMATCH';
        result.outcome = 'failed';
        return result;
      }
      const { runWebRtcVoice } = await import('./webrtc-voice.js');
      await runWebRtcVoice({ config, pcm, session, result, started, signal, confirmDelivery });
      return result;
    }
    if (session.livekit) {
      result.failureCode = 'BENCHMARK_TRANSPORT_MISMATCH';
      return result;
    }
    result.transport = 'websocket';
    result.firstAudioBoundary = 'ws-pcm-receipt-v1';
    const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    socket = new WebSocket(config.baseUrl.replace('http:', 'ws:') + '/voice', {
      headers: { ...headers, Cookie: cookie }, maxPayload: 131072,
      handshakeTimeout: Math.min(10000, config.timeoutMs), followRedirects: false });
    const ws = socket;
    let sequence = 0, ref: VoiceResponseRef | undefined;
    let received = 0, played = 0, progressAt = performance.now(), audioBase = 0;
    const send = (payload: VoiceClientPayload) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ protocolVersion: 1,
        sessionId: session.sessionId, connectionEpoch: session.connectionEpoch,
        eventId: randomUUID(), sequence: sequence++, ...payload }));
    };
    let resolveReady!: () => void, resolveEnd!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, no) => { resolveReady = resolve; reject = no; });
    const end = new Promise<void>((resolve, no) => { resolveEnd = resolve; const previous = reject; reject = error => { previous(error); no(error); }; });
    const rejectBoth = reject;
    reject = error => { stopped = true; rejectBoth(error); ws.terminate(); };
    // Attach a rejection handler before connection/setup can fail.
    void end.catch(() => undefined);
    const abort = () => { reject(new Error('BENCHMARK_TIMEOUT')); ws.terminate(); };
    signal.addEventListener('abort', abort, { once: true });
    ws.once('error', () => reject(new Error('BENCHMARK_SOCKET_ERROR')));
    ws.once('close', () => { if (!stopped) reject(new Error('BENCHMARK_SOCKET_CLOSED')); });
    ws.once('open', () => send({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO }));
    ws.on('message', (data, binary) => {
      try {
        if (!Buffer.isBuffer(data)) throw new Error('INVALID_BENCHMARK_FRAME');
        if (binary) {
          const frame = decodeVoiceAudio(new Uint8Array(data));
          if (frame.kind !== 2 || !ref) throw new Error('INVALID_BENCHMARK_AUDIO');
          if (result.firstAudioMs === null) {
            result.firstAudioMs = performance.now() - started;
            result.speechEndToFirstAudioMs = result.speechEndClockMs === undefined ? null
              : performance.now() - result.speechEndClockMs;
            progressAt = performance.now();
          }
          received += frame.pcm.byteLength / 2;
          return;
        }
        const event = parseVoiceControl(data.toString(), 'server', 'live');
        if (event.sessionId !== session.sessionId || event.connectionEpoch !== session.connectionEpoch) throw new Error('BENCHMARK_CORRELATION');
        if (event.type === 'session.ready') resolveReady();
        if (event.type === 'conversation.bound') result.sessionId = event.conversationId;
        if (event.type === 'voice.state' && event.agent === 'thinking' && result.speechEndToThinkingMs === undefined && result.speechEndClockMs !== undefined) {
          const elapsed = performance.now() - result.speechEndClockMs;
          if (elapsed < 0) throw new Error('BENCHMARK_EARLY_ENDPOINT');
          result.speechEndToThinkingMs = elapsed;
        }
        if (event.type === 'audio.start') {
          if (ref) throw new Error('BENCHMARK_MULTIPLE_RESPONSES');
          ref = { turnId: event.turnId, responseId: event.responseId }; result.turnId = event.turnId;
          audioBase = event.firstAudioSample ?? 0; received = audioBase; played = audioBase;
        }
        if (event.type === 'audio.end') {
          if (!ref || !received || result.firstAudioMs === null || event.turnId !== ref.turnId || event.responseId !== ref.responseId) throw new Error('INVALID_BENCHMARK_COMPLETION');
          result.speechEndToPlaybackEndMs = result.speechEndClockMs === undefined ? null : performance.now() - result.speechEndClockMs;
          result.outcome = 'completed'; result.completed = true; resolveEnd();
        }
        if (event.type === 'session.error' || event.type === 'session.ended' || event.type === 'response.cancelled') reject(new Error('BENCHMARK_VOICE_FAILED'));
      } catch { reject(new Error('BENCHMARK_VOICE_FAILED')); }
    });
    try {
      await ready;
      result.setupMs = performance.now() - started;
      const inputStarted = performance.now();
      // The known speech-end marker lives on this client's monotonic clock.
      result.speechEndClockMs = inputStarted + config.speechEndMs;
      timer = setInterval(() => {
        if (!ref || result.firstAudioMs === null) return;
        const now = performance.now();
        played = Math.min(received, played + Math.floor((now - progressAt) * 24));
        progressAt = now;
        send({ type: 'playback.progress', ...ref, playedSamples: played, playedMs: Math.floor(played / 24) });
      }, 40);
      for (let offset = 0, n = 0; offset < pcm.length; offset += 2560, n++) {
        if (stopped || result.completed) break;
        await sleep(Math.max(0, inputStarted + n * 80 - performance.now()), undefined, { signal });
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 65536) throw new Error('BENCHMARK_INPUT_BACKPRESSURE');
        const part = new Uint8Array(2560);
        part.set(pcm.subarray(offset, offset + 2560));
        ws.send(encodeVoiceAudio({ kind: 1, flags: 0, sequence: n, offsetMs: n * 80, pcm: part }));
        result.inputAudioMs! += 80;
      }
      await end;
      result.audioDurationMs = (received - audioBase) / 24;
      // Keep the socket/session alive while required durable delivery finishes.
      // Ending on audio.end alone can cancel the still-finalizing application turn.
      if (confirmDelivery) {
        const confirmed = await confirmDelivery(result, signal);
        if (signal.aborted) throw new Error('BENCHMARK_TIMEOUT');
        result.durableCompletionMs = confirmed ? performance.now() - started : null;
        if (!confirmed) result.outcome = 'unverified';
      }
    } finally {
      signal.removeEventListener('abort', abort);
      stopped = true;
      send({ type: 'session.end' });
    }
  } catch {
    result.outcome = signal.aborted ? 'timeout' : 'failed';
  } finally {
    const cleanupStarted = performance.now();
    result.durationMs = cleanupStarted - started;
    stopped = true;
    if (timer) clearInterval(timer);
    socket?.terminate();
    if (result.voiceSessionId) {
      try { await fetch(`${config.baseUrl}/voice/sessions/${encodeURIComponent(result.voiceSessionId)}`,
        { method: 'DELETE', headers, signal: AbortSignal.timeout(5000), redirect: 'error' }); } catch { /* Never retry speech or inference. */ }
    }
    result.cleanupMs = performance.now() - cleanupStarted;
  }
  return result;
}
