/**
 * ============================================================================
 * FILE: dictation-controller.ts
 * LOCATION: frontend/src/features/voice/dictation/dictation-controller.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Controller managing voice dictation lifecycle, ports, state, and draft updates.
 *
 * ROLE IN PROJECT:
 *    Owns audio capture and voice client instances for dictation sessions,
 *    coordinates draft snapshotting, and manages fence tokens against stale events.
 *
 * KEY COMPONENTS:
 *    - DictationController: State machine and port coordinator
 *    - DictationBindings: UI binding contracts (chat state lease/write)
 *    - DictationPorts: Hardware and transport dependencies
 *    - DictationView: Published state snapshot for React
 * ============================================================================
 */

import type { VoiceHttpClient, VoiceClient, VoiceClientOptions } from '../../../api/voice-client.ts';
import { ApiClientError } from '../../../api/client.ts';
import type { PublicVoiceConfig, CreateVoiceSessionResponse, VoiceServerEvent } from '../../../api/voice-protocol.ts';
import type { AudioCaptureService } from '../audio/audio-capture-service.ts';
import { DictationDraft, type DraftSelection, type DraftSnapshot } from './dictation-draft.ts';

export type DictationBindings = {
  claimVoiceInput: (mode: 'dictation' | 'live', onClose: () => void) => string | null;
  writeVoiceDraft: (token: string, text: string) => boolean;
  releaseVoiceInput: (token: string) => void;
  isVoiceInputLocked: () => boolean;
};
export type DictationPorts = {
  http: Pick<VoiceHttpClient, 'create' | 'end'>;
  bindings: DictationBindings;
  capture: (options: ConstructorParameters<typeof AudioCaptureService>[0]) =>
    Pick<AudioCaptureService, 'start' | 'setMuted' | 'stop'>;
  client: (options: VoiceClientOptions) => Pick<VoiceClient, 'connect' | 'sendInput' | 'control' | 'dispose'>;
};
export type DictationView = {
  phase: 'idle' | 'requesting_permission' | 'connecting' | 'recording' | 'finalizing' | 'draft_ready';
  notice: string | null;
  selection: DraftSelection | null;
  selectionDraft: string | null;
};
type Run = { token: string; draft: DictationDraft; abort: AbortController;
  capture?: ReturnType<DictationPorts['capture']>; client?: ReturnType<DictationPorts['client']>;
  session?: CreateVoiceSessionResponse; ready: boolean; endRequested: boolean;
  finalizationTimer?: ReturnType<typeof setTimeout>;
  durationTimer?: ReturnType<typeof setTimeout>; };

const tailWarning = 'Some speech may be missing. Review your draft or dictate the remaining words again.';
function message(code: string) {
  if (code === 'MICROPHONE_DENIED') return 'Microphone access was denied. You can still type your message.';
  if (code === 'MICROPHONE_UNAVAILABLE' || code === 'MICROPHONE_LOST') return 'Microphone unavailable. Saved speech is kept; you can still type.';
  if (code === 'UNSUPPORTED_AUDIO' || code === 'PLAYBACK_BLOCKED') return 'Voice is unavailable in this browser. You can still type.';
  if (code === 'DICTATION_DRAFT_LIMIT') return 'The message limit was reached. Saved speech is kept; review or shorten your draft.';
  if (code === 'DICTATION_FINALIZATION_TIMEOUT') return tailWarning;
  if (code === 'VOICE_QUOTA_EXHAUSTED') return 'The voice limit was reached. Saved speech is kept; you can still type.';
  if (code === 'STT_UNAVAILABLE') return 'Speech recognition disconnected. Saved speech is kept; you can still type.';
  if (code === 'DICTATION_FOREGROUND_REQUIRED') {
    return 'Dictation paused because this page left the foreground. Saved speech is kept; select Dictate message to record again.';
  }
  return 'Dictation ended unexpectedly. Saved speech is kept; select Dictate message to record again.';
}

export class DictationController {
  private readonly ports: DictationPorts;
  private run: Run | null = null;
  private view: DictationView = { phase: 'idle', notice: null, selection: null, selectionDraft: null };
  private listeners = new Set<() => void>();
  constructor(ports: DictationPorts) { this.ports = ports; }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<DictationView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private current(run: Run) { return this.run === run && !run.abort.signal.aborted; }
  async start(snapshot: DraftSnapshot, conversationId: string | null, config: PublicVoiceConfig) {
    if (this.run || !config.enabledModes.dictation) return;
    const token = this.ports.bindings.claimVoiceInput('dictation', () => this.disconnect());
    if (!token) return;
    const run: Run = { token, draft: new DictationDraft(snapshot), abort: new AbortController(),
      ready: false, endRequested: false };
    this.run = run;
    this.publish({ phase: 'requesting_permission', notice: null, selection: null, selectionDraft: null });
    try {
      run.capture = this.ports.capture({ maxPendingMs: config.limits.inputQueueMs,
        frame: (pcm, flags) => {
          if (!this.current(run) || !run.ready) return;
          if (!run.client?.sendInput(pcm, flags)) this.disconnect('DICTATION_DISCONNECTED');
        }, error: code => { if (this.current(run)) this.disconnect(code); } });
      // start() calls getUserMedia before its first await; never invoke this from an effect.
      await run.capture.start();
      if (!this.current(run)) return;
      this.publish({ phase: 'connecting' });
      run.session = await this.ports.http.create({ protocolVersion: 1, mode: 'dictation',
        conversationId, locale: 'en-US', idempotencyKey: crypto.randomUUID() }, run.abort.signal);
      if (!this.current(run)) { this.endSession(run); return; }
      run.client = this.ports.client({ event: event => this.event(run, event),
        lost: () => { if (this.current(run)) this.disconnect(); },
        error: code => { if (this.current(run)) this.disconnect(code); },
        ended: () => { if (this.current(run)) this.disconnect(); } });
      run.client.connect(run.session);
    } catch (error) {
      if (this.current(run)) this.disconnect(error instanceof ApiClientError ? error.code : error instanceof Error ? error.message : 'VOICE_CONNECT_TIMEOUT');
    }
  }
  private event(run: Run, event: VoiceServerEvent) {
    if (!this.current(run) || event.sessionId !== run.session?.sessionId ||
      event.connectionEpoch !== run.session.connectionEpoch) return;
    if (event.type === 'session.ready') {
      void this.ready(run);
    } else if (event.type === 'dictation.partial' || event.type === 'dictation.final') {
      try {
        run.draft.accept(event.type, event.segmentId, event.text);
        this.ports.bindings.writeVoiceDraft(run.token, run.draft.text());
      } catch { this.disconnect('DICTATION_DRAFT_LIMIT'); }
    } else if (event.type === 'dictation.complete') {
      this.finish(run, false,
        event.finalization === 'timeout' || event.unfinalizedTail ? tailWarning : null, true);
    } else if (event.type === 'session.warning') {
      this.publish({ notice: message(event.code) });
    } else if (event.type === 'session.error') {
      this.disconnect(event.code);
    } else if (event.type === 'session.ended') {
      this.disconnect();
    }
  }
  private async ready(run: Run) {
    try {
      await run.capture!.setMuted(false, run.session!.limits.inputQueueMs);
      if (!this.current(run)) return;
      run.ready = true;
      run.durationTimer = setTimeout(() => {
        if (this.current(run)) void this.stop();
      }, run.session!.limits.dictationMaxMs);
      this.publish({ phase: 'recording' });
    } catch { if (this.current(run)) this.disconnect('UNSUPPORTED_AUDIO'); }
  }
  async stop() {
    const run = this.run;
    if (!run || this.view.phase !== 'recording') return;
    clearTimeout(run.durationTimer);
    this.publish({ phase: 'finalizing' });
    run.finalizationTimer = setTimeout(() => {
      if (this.current(run)) this.finish(run, false, tailWarning, true);
    }, Math.min(2_000, run.session!.limits.finalizationMs));
    try {
      await run.capture!.stop(true);
      if (!this.current(run)) return;
      if (!run.client!.control({ type: 'dictation.stop' })) this.disconnect();
    } catch { if (this.current(run)) this.disconnect('DICTATION_FINALIZATION_TIMEOUT'); }
  }
  cancel() {
    const run = this.run;
    if (!run) return;
    this.finish(run, true, null, true);
  }
  disconnect(code = 'DICTATION_DISCONNECTED') {
    const run = this.run;
    if (run) this.finish(run, false, message(code), false);
  }
  private endSession(run: Run) {
    if (!run.session || run.endRequested) return;
    run.endRequested = true;
    void this.ports.http.end(run.session.sessionId).catch(() => {});
  }
  private finish(run: Run, cancelled: boolean, notice: string | null, restore: boolean) {
    if (this.run !== run) return;
    this.run = null; // Fence callbacks before any external cleanup or draft dispatch.
    clearTimeout(run.finalizationTimer);
    clearTimeout(run.durationTimer);
    run.abort.abort();
    if (cancelled) {
      try { run.client?.control({ type: 'dictation.cancel' }); } catch { /* Cleanup remains mandatory. */ }
    }
    run.client?.dispose();
    void run.capture?.stop(false).catch(() => {});
    this.endSession(run);
    const text = cancelled ? run.draft.snapshot.original : run.draft.text(false);
    const written = this.ports.bindings.writeVoiceDraft(run.token, text);
    this.ports.bindings.releaseVoiceInput(run.token);
    this.publish({ phase: 'draft_ready', notice,
      selection: written && restore ? cancelled ? run.draft.snapshot.selection : run.draft.caret() : null,
      selectionDraft: written && restore ? text : null });
  }
}


