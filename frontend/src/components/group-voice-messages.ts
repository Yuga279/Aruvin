/**
 * ============================================================================
 * FILE: group-voice-messages.ts
 * LOCATION: frontend/src/components/group-voice-messages.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Consolidate contiguous voice session turns into a single voice call pill.
 *
 * ROLE IN PROJECT:
 *    Preserves a consolidated Voice Chat duration + full-transcript pill per call
 *    block, keeping all spoken turns and Canvas visual artifacts strictly inside
 *    the call transcript window rather than leaking into the main text chat region.
 *
 * KEY COMPONENTS:
 *    - clearVoiceDurationsCache: Resets cached per-session duration fallbacks.
 *    - groupVoiceMessages: Groups consecutive voiceSessionId messages into a single
 *      Voice Chat indicator pill whose transcript contains all speech and Canvas artifacts.
 * ============================================================================
 */

import type { VisibleMessage, VoiceTranscriptItem } from '../api/protocol.ts';

const knownVoiceDurations = new Map<string, number>();

export function clearVoiceDurationsCache(): void {
  knownVoiceDurations.clear();
}

function collectGroupTranscripts(group: readonly VisibleMessage[]): VoiceTranscriptItem[] {
  const allTranscripts: VoiceTranscriptItem[] = [];
  for (const msg of group) {
    if (msg.voiceTranscripts && msg.voiceTranscripts.length > 0) {
      for (const t of msg.voiceTranscripts) {
        allTranscripts.push({
          ...t,
          ...(t.role === 'assistant' && (t.calendarView ?? msg.calendarView)
            ? {calendarView:t.calendarView ?? msg.calendarView,messageId:t.messageId ?? msg.messageId,turnId:t.turnId ?? msg.turnId} : {}),
          ...(t.canvasArtifacts?.length
            ? { canvasArtifacts: t.canvasArtifacts }
            : msg.canvasArtifacts?.length && t.role === 'assistant'
              ? { canvasArtifacts: msg.canvasArtifacts }
              : {}),
          ...(t.messageId
            ? { messageId: t.messageId }
            : msg.canvasArtifacts?.length && t.role === 'assistant' && msg.messageId
              ? { messageId: msg.messageId }
              : {}),
        });
      }
    } else if (msg.content || msg.canvasArtifacts?.length || msg.calendarView) {
      allTranscripts.push({
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        ...(msg.role === 'assistant' && msg.calendarView
          ? {calendarView:msg.calendarView,messageId:msg.messageId,turnId:msg.turnId} : {}),
        ...(msg.canvasArtifacts?.length && msg.role === 'assistant' ? { canvasArtifacts: msg.canvasArtifacts } : {}),
        ...(msg.canvasArtifacts?.length && msg.role === 'assistant' && msg.messageId ? { messageId: msg.messageId } : {}),
      });
    }
  }
  return allTranscripts;
}

function resolveGroupDuration(
  sessionId: string,
  group: readonly VisibleMessage[],
): number | undefined {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const explicitDuration =
    group.find(
      (m) => typeof m.voiceDurationSeconds === 'number' && m.voiceDurationSeconds > 0,
    )?.voiceDurationSeconds ?? knownVoiceDurations.get(sessionId);

  let calculatedDuration: number | undefined = explicitDuration;
  if (calculatedDuration === undefined && first.createdAt && last.createdAt) {
    const startMs = new Date(first.createdAt).getTime();
    const endMs = new Date(last.createdAt).getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
      const diffSec = Math.round((endMs - startMs) / 1000);
      if (diffSec > 0) {
        calculatedDuration = diffSec;
      }
    }
  }

  if (typeof calculatedDuration === 'number' && calculatedDuration > 0) {
    knownVoiceDurations.set(sessionId, calculatedDuration);
  }
  return calculatedDuration;
}

export function groupVoiceMessages(messages: VisibleMessage[]): VisibleMessage[] {
  const result: VisibleMessage[] = [];
  const usedPillIds = new Set<string>();
  let currentGroup: VisibleMessage[] = [];
  let currentSessionId: string | null = null;

  const nextPillMessageId = (sessionId: string): string => {
    const base = `voice_call_${sessionId}`;
    if (!usedPillIds.has(base)) {
      usedPillIds.add(base);
      return base;
    }
    const disambiguated = `${base}_${result.length}`;
    usedPillIds.add(disambiguated);
    return disambiguated;
  };

  const flush = () => {
    if (currentGroup.length === 0 || !currentSessionId) {
      currentGroup = [];
      currentSessionId = null;
      return;
    }

    const allTranscripts = collectGroupTranscripts(currentGroup);
    const calculatedDuration = resolveGroupDuration(currentSessionId, currentGroup);
    const first = currentGroup[0]!;
    const last = currentGroup[currentGroup.length - 1]!;

    const consolidated: VisibleMessage = {
      messageId: nextPillMessageId(currentSessionId),
      turnId: last.turnId,
      eventId: last.eventId,
      sequence: last.sequence,
      role: 'assistant',
      content: '',
      createdAt: first.createdAt,
      completionStatus: last.completionStatus,
      truncated: last.truncated,
      mode: 'live',
      visibility: 'visible',
      voiceSessionId: currentSessionId,
      voiceDurationSeconds: calculatedDuration,
      voiceTranscripts: allTranscripts,
    };
    result.push(consolidated);

    currentGroup = [];
    currentSessionId = null;
  };

  for (const msg of messages) {
    if (msg.voiceSessionId) {
      if (currentSessionId === msg.voiceSessionId) {
        currentGroup.push(msg);
      } else {
        flush();
        currentSessionId = msg.voiceSessionId;
        currentGroup = [msg];
      }
    } else {
      flush();
      result.push(msg);
    }
  }

  flush();
  return result;
}
