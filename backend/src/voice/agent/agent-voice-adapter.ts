/**
 * ============================================================================
 * FILE: agent-voice-adapter.ts
 * LOCATION: backend/src/voice/agent/agent-voice-adapter.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bridge live voice speech input and playback events to the shared runtime.
 *
 * ROLE IN PROJECT:
 *    Manages finalized speech turn submission, conversation binding, response
 *    preparation, safe prose streaming to TTS, and delivery reconciliation.
 *
 * KEY COMPONENTS:
 *    - voiceRequestKey: Namespaced idempotency key from session and STT socket epoch.
 *    - AgentVoiceAdapter: Connects LiveFlow lifecycle hooks to DurableChatRuntime.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { key } from '../../persistence/records.js';
import { sessionIdFor } from '../../chat-runtime/identity.js';
import type { DurableChatRuntime } from '../../chat-runtime/durable-chat-runtime.js';
import type { SessionContext, VoiceSink, LiveHooks } from '../session/voice-session.options.js';
import { voiceError, VoiceSessionError } from '../session/voice-session.options.js';
import type { LiveFlow } from '../session/live-flow.js';
import type { CanvasArtifactProjection, CalendarConfirmPayload } from '../../contracts/voice-wire.js';
import { calendarPresentationEventSchema } from '../../contracts/calendar-wire.js';
import type { CalendarProposalView } from '../../contracts/calendar-view.js';
import type { CalendarReplyReference } from '../../contracts/calendar-authority.js';
import { voiceDeliveryRecordSchema } from '../../contracts/voice.js';
import { VoiceDelivery } from './voice-delivery.js';

export type FinalizedSpeech = { providerSocketEpoch: number; providerTurnId: string; text: string;
  calendarReplyTo?: CalendarReplyReference };

export type VoiceBridgeRuntime = Pick<DurableChatRuntime, 'submitLiveTurn'> & Partial<Pick<DurableChatRuntime,
  'executeTurn' | 'cancelLiveTurn' | 'reconcileSession' | 'getLiveTurnStatus' | 'findLiveSubmission' | 'getLiveDelivery'>>;

type Active = {
  ids: { sessionId: string; turnId: string; attemptId: string };
  responseId: string;
  controller: AbortController;
  delivery?: VoiceDelivery;
  invalid: boolean;
  done?: Promise<void>;
  failure?: VoiceSessionError;
  audioStarted?: boolean;
  preAudioCancelled?: boolean;
  emittedArtifactOrdinals?: Set<number>;
};

export const voiceRequestKey = (voiceSessionId: string, input: FinalizedSpeech) =>
  key('voice-input', voiceSessionId, String(input.providerSocketEpoch), input.providerTurnId);

export class AgentVoiceAdapter {
  private context?: SessionContext;
  private flow?: LiveFlow;
  private sink?: VoiceSink;
  private active?: Active;
  private closed = false;
  /** Latest trusted disclosure; correlation only, never authorization. */
  private calendarProposal?: CalendarProposalView;
  private submitted = new Map<string, { text: string; promise: Promise<void> }>();
  private running: Promise<void> = Promise.resolve();
  private acceptingTurn = false;

  readonly hooks: LiveHooks = {
    finalized: (c, input, signal) => this.finalized(c, input, signal),
    interrupt: (c, ref) => this.interrupt(c, ref),
    delivery: (c, event) => {
      this.check(c);
      const a = this.forResponse(event);
      if (event.type === 'speech-started' && a) {
        a.audioStarted = true;
      }
      return a?.delivery?.event(event) ?? Promise.resolve();
    },
    playback: (c, ref, samples) => {
      this.check(c);
      const a = this.forResponse(ref);
      a?.delivery?.observePlayback(samples);
      return Promise.resolve();
    },
    disconnected: c => this.disconnected(c),
    calendarControl: (c, input, signal) => this.calendarControl(c, input, signal),
  };

  constructor(
    readonly runtime: VoiceBridgeRuntime,
    readonly bindConversation: (voiceSessionId: string, conversationId: string) => Promise<void>
  ) {}

  attach(c: SessionContext, flow: LiveFlow, sink: VoiceSink) {
    if (this.flow || !this.runtime.executeTurn || !this.runtime.cancelLiveTurn ||
      !this.runtime.reconcileSession || !this.runtime.getLiveTurnStatus || !this.runtime.findLiveSubmission ||
      !this.runtime.getLiveDelivery)
      throw new VoiceSessionError('VOICE_INVALID_STATE');
    this.context = c;
    this.flow = flow;
    this.sink = sink;
  }

  private check(c: SessionContext) {
    if (c !== this.context || c.response.mode !== 'live') throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
  }

  private forResponse(ref: { turnId: string; responseId: string }) {
    const a = this.active;
    return a?.ids.turnId === ref.turnId && a.responseId === ref.responseId ? a : undefined;
  }

  currentResponse() {
    return this.active ? { turnId: this.active.ids.turnId, responseId: this.active.responseId } : null;
  }

  finalized(c: SessionContext, input: FinalizedSpeech, signal: AbortSignal): Promise<void> {
    this.check(c);
    if (this.closed || !input.text.trim()) return Promise.resolve();
    const requestKey = voiceRequestKey(c.response.sessionId, input);
    const old = this.submitted.get(requestKey);
    if (old) {
      if (old.text !== input.text) return Promise.reject(new VoiceSessionError('VOICE_BINDING_MISMATCH'));
      return old.promise;
    }
    if (this.submitted.size >= 4096) return Promise.reject(new VoiceSessionError('VOICE_SEQUENCE_ERROR'));
    if (this.acceptingTurn) return Promise.reject(new VoiceSessionError('CONFLICT_ACTIVE_TURN'));
    this.acceptingTurn = true;
    const promise = this.running.then(() => this.run(c, input, signal)).finally(() => { this.acceptingTurn = false; });
    this.running = promise;
    this.submitted.set(requestKey, { text: input.text, promise });
    return promise;
  }

  private async run(c: SessionContext, input: FinalizedSpeech, signal: AbortSignal) {
    if (this.active) await this.active.done;
    if (this.closed || signal.aborted) return;
    if (!await this.flow!.waitForOutput(signal)) return;
    const requestKey = voiceRequestKey(c.response.sessionId, input);
    const freshConversation = c.response.conversationId === null;
    const conversationId = sessionIdFor(c.identity.userId, c.response.conversationId, requestKey);
    if (c.response.conversationId !== conversationId || c.reservation?.conversationId !== conversationId) {
      await this.bindConversation(c.response.sessionId, conversationId);
    }
    if (await this.runtime.findLiveSubmission!({ identity: c.identity, sessionId: conversationId,
      content: input.text, idempotencyKey: requestKey, reservation: c.reservation!, freshConversation,
      voice: { voiceSessionId: c.response.sessionId, socketEpoch: input.providerSocketEpoch, providerTurnId: input.providerTurnId },
      ...(input.calendarReplyTo ? { calendarReplyTo: input.calendarReplyTo } : {}) })) {
      await this.runtime.reconcileSession!(c.identity.userId, conversationId);
      return;
    }
    const ids = await this.submit(c, input, freshConversation);
    if (!ids) return;
    const status = await this.runtime.getLiveTurnStatus!(c.identity.userId, ids.sessionId, ids.turnId, c.reservation!);
    this.sink!.event({
      type: 'conversation.bound',
      conversationId: ids.sessionId,
      ...(status.save ? { turnId: ids.turnId, save: status.save } : {}),
    });
    if (status.status !== 'accepted') {
      await this.runtime.reconcileSession!(c.identity.userId, ids.sessionId);
      return; // Never infer or speak on replay.
    }
    if (this.closed || signal.aborted) {
      await this.runtime.cancelLiveTurn!({ identity: c.identity, ...ids }, c.reservation!);
      return;
    }
    const responseId = key('voice-response', c.identity.userId, ids.sessionId, ids.attemptId);
    const controller = new AbortController();
    const active: Active = { ids, responseId, controller, invalid: false };
    this.active = active;
    const base = this.flow!.prepareResponse({ turnId: ids.turnId, responseId }).providerBaseSamples;
    const disconnect = () => { active.invalid = true; active.delivery?.invalidate(); controller.abort(); };
    signal.addEventListener('abort', disconnect, { once: true });
    if (signal.aborted) disconnect();
    const execute = this.runtime.executeTurn!({
      userId: c.identity.userId,
      ...ids,
      signal: controller.signal,
      emit: async () => undefined,
      emitCalendar: async frame => {
        if (this.closed || active.invalid || controller.signal.aborted || this.active !== active
          || frame.sessionId !== active.ids.sessionId || frame.turnId !== active.ids.turnId
          || frame.attemptId !== active.ids.attemptId) return;
        const parsed = calendarPresentationEventSchema.safeParse(frame.event);
        if (!parsed.success) return; // excludes delta/status/completed and legacy v1 operation frames
        const event = parsed.data;
        if (event.type === 'calendar-view' && event.view.kind === 'proposal') this.calendarProposal = event.view;
        if (event.type === 'calendar-clarification' && event.view) this.calendarProposal = event.view;
        try {
          this.sink!.event({ type: 'calendar.frame', turnId: active.ids.turnId,
            attemptId: active.ids.attemptId, responseId, event });
        } catch { /* Best-effort visual delivery never changes the calendar outcome. */ }
      },
      live: {
        reservation: c.reservation!,
        start: async (attempt, write) => {
          const at = new Date().toISOString();
          active.delivery = new VoiceDelivery(voiceDeliveryRecordSchema.parse({
            schemaVersion: 1,
            kind: 'voice-delivery',
            userId: attempt.userId,
            sessionId: attempt.sessionId,
            voiceSessionId: c.response.sessionId,
            turnId: attempt.turnId,
            attemptId: attempt.attemptId,
            responseId,
            eventId: randomUUID(),
            sequence: 1,
            speechId: null,
            providerSocketId: this.flow!.providerSocketId,
            status: 'pending',
            audioDurationMs: null,
            audioPlayedMs: null,
            playedSamples: null,
            textGenerated: '',
            textSpoken: null,
            textRemaining: null,
            createdAt: at,
            updatedAt: at
          }), base, write, this.flow!, c.response.limits.finalizationMs, {
            activeMs: Math.min(c.configSnapshot?.budgets.totalRunTimeoutMs ?? 180000, c.response.limits.liveMaxMs),
            stallMs: 30000,
          });
          if (active.invalid) active.delivery.invalidate();
          await this.deliveryAction(active, () => active.delivery!.start());
        },
        delta: text => this.deliveryAction(active, () => active.delivery!.delta(text)),
        artifact: async (artifact: CanvasArtifactProjection): Promise<boolean> => {
          if (this.closed || active.invalid || controller.signal.aborted || this.active !== active ||
            c.response.mode !== 'live' || artifact.responseId !== responseId || !active.delivery) {
            return false;
          }
          const admitted = await this.deliveryAction(active, () => active.delivery!.artifact(artifact));
          if (!admitted) return false;
          if (this.closed || active.invalid || controller.signal.aborted || this.active !== active) {
            return true;
          }
          active.emittedArtifactOrdinals ??= new Set<number>();
          if (!active.emittedArtifactOrdinals.has(artifact.ordinal)) {
            active.emittedArtifactOrdinals.add(artifact.ordinal);
            this.sink!.event({
              type: 'canvas.artifact',
              turnId: active.ids.turnId,
              ...artifact,
            });
          }
          return true;
        },
        finish: () => this.deliveryAction(active, () => active.delivery!.finish()),
        modelStarted: () => this.flow!.modelStarted({ responseId }),
        modelOutput: () => this.flow!.modelOutput({ responseId }),
        settle: (generated, signal) => this.deliveryAction(active, () => active.delivery!.settle(generated, signal)),
      }
    });
    active.done = execute.catch(async error => {
      const state = await this.runtime.getLiveTurnStatus!(c.identity.userId, ids.sessionId, ids.turnId, c.reservation!);
      if (!['cancelled', 'interrupted'].includes(state.status)) throw active.failure ?? error;
    }).finally(() => {
      signal.removeEventListener('abort', disconnect);
      if (this.active === active) this.active = undefined;
    });
    await active.done;
    if (status.save && !this.closed) {
      const settled = await this.runtime.getLiveTurnStatus!(c.identity.userId, ids.sessionId, ids.turnId, c.reservation!).catch(() => null);
      if (settled?.save && !this.closed) {
        try {
          this.sink?.event({
            type: 'conversation.bound',
            conversationId: ids.sessionId,
            turnId: ids.turnId,
            save: settled.save,
          });
        } catch {
          // sink may close during teardown
        }
      }
    }
    const delivery = active.delivery?.current()
      ?? await this.runtime.getLiveDelivery!(c.identity.userId, ids.sessionId, ids.attemptId, c.reservation!);
    this.flow!.deliverySettled({ turnId: ids.turnId, responseId }, !delivery || ['unknown', 'failed'].includes(delivery.status));
    if (!active.invalid && (delivery?.status === 'unknown' || delivery?.status === 'failed')) throw new VoiceSessionError('VOICE_DELIVERY_UNKNOWN');
    if (!delivery?.textGenerated && !active.invalid) throw new VoiceSessionError('VOICE_AGENT_FAILED');
  }

  async interrupt(c: SessionContext, ref: { turnId: string; responseId: string }) {
    this.check(c);
    const a = this.forResponse(ref);
    if (!a || a.invalid) return;
    a.invalid = true;
    a.delivery?.invalidate();
    if (!a.audioStarted && !a.preAudioCancelled) {
      a.preAudioCancelled = true;
      try {
        this.sink?.event({ type: 'response.cancelled', turnId: ref.turnId, responseId: ref.responseId, lastAudioSequence: null });
      } catch {
        // protect cancellation so a throwing sink cannot prevent cancelLiveTurn/abort
      }
    }
    // cancelLiveTurn synchronously marks Work CANCELLED before its first await.
    const cancellation = this.runtime.cancelLiveTurn!({ identity: c.identity, ...a.ids }, c.reservation!);
    a.controller.abort();
    await cancellation;
  }

  private async deliveryAction<T>(active: Active, action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) { active.failure ??= voiceError(error, 'VOICE_DELIVERY_UNKNOWN'); throw error; }
  }

  async disconnected(c: SessionContext) {
    this.check(c);
    this.closed = true;
    const a = this.active;
    if (a) {
      a.invalid = true;
      a.delivery?.invalidate();
      a.controller.abort();
      await a.done?.catch(() => undefined);
    }
    await this.running.catch(() => undefined);
    if (c.response.conversationId) {
      await this.runtime.reconcileSession!(c.identity.userId, c.response.conversationId);
    }
  }

  async submit(c: SessionContext, input: FinalizedSpeech, freshConversation = false) {
    if (!input.text.trim()) return null;
    if (c.response.mode !== 'live' || !c.reservation || c.reservation.owner.kind !== 'live' ||
      c.reservation.owner.voiceSessionId !== c.response.sessionId) throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
    const idempotencyKey = voiceRequestKey(c.response.sessionId, input);
    const sessionId = sessionIdFor(c.identity.userId, c.response.conversationId, idempotencyKey);
    if (c.response.conversationId !== sessionId || c.reservation.conversationId !== sessionId) {
      await this.bindConversation(c.response.sessionId, sessionId);
    }
    if (!c.reservation || c.reservation.conversationId !== sessionId || c.response.conversationId !== sessionId)
      throw new VoiceSessionError('VOICE_BINDING_MISMATCH');
    return this.runtime.submitLiveTurn({ identity: c.identity, sessionId, content: input.text,
      idempotencyKey, reservation: c.reservation,
      freshConversation,
      voice: { voiceSessionId: c.response.sessionId, socketEpoch: input.providerSocketEpoch, providerTurnId: input.providerTurnId },
      ...(input.calendarReplyTo ? { calendarReplyTo: input.calendarReplyTo } : {}),
      ...(c.configSnapshot ? { configSnapshot: c.configSnapshot } : {}) });
  }

  async calendarControl(c: SessionContext, input: CalendarConfirmPayload, signal: AbortSignal): Promise<void> {
    this.check(c);
    const p = this.calendarProposal;
    if (!p || p.proposalId !== input.proposalId || p.revision !== input.proposalRevision)
      throw new VoiceSessionError('INVALID_VOICE_CONTROL', 'none');
    const answer = input.answer;
    let text: string;
    if (answer.kind === 'select') {
      const candidate = p.candidates.find(candidate => candidate.calendarId === answer.calendarId);
      if (!candidate) throw new VoiceSessionError('INVALID_VOICE_CONTROL', 'none');
      text = candidate.calendarId;
    } else text = answer.kind === 'accept' ? 'yes' : 'cancel';
    const providerTurnId = key('calendar-confirm', p.proposalId, String(p.revision), answer.kind,
      answer.kind === 'select' ? text : '');
    await this.finalized(c, { providerSocketEpoch: c.response.connectionEpoch, providerTurnId, text,
      calendarReplyTo: { proposalId: p.proposalId, revision: p.revision } }, signal);
  }
}
