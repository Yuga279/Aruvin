/**
 * ============================================================================
 * FILE: group-voice-messages.test.ts
 * LOCATION: frontend/src/components/group-voice-messages.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for consolidating contiguous voice session turns into telephone call records.
 *
 * ROLE IN PROJECT:
 *    Ensures that multiple back-and-forth turns within a single voice call are
 *    rendered as a single voice chat item in the chat transcript with all transcripts
 *    and Canvas visuals available inside its modal window.
 *
 * KEY COMPONENTS:
 *    - groupVoiceMessages tests for text passthrough, single turns, multi-turn grouping,
 *      and duration calculation.
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VisibleMessage } from '../api/protocol.ts';
import { agenda, calendarMessage } from '../features/canvas/testing/calendar-view-fixtures.ts';
import { clearVoiceDurationsCache, groupVoiceMessages } from './group-voice-messages.ts';
import { VoiceTranscriptModal } from './VoiceTranscriptModal.tsx';

function createTextMessage(id: string, role: 'user' | 'assistant', content: string): VisibleMessage {
  return {
    messageId: id,
    turnId: `turn_${id}`,
    eventId: `evt_${id}`,
    sequence: 1,
    role,
    content,
    createdAt: '2026-10-15T10:00:00.000Z',
    completionStatus: 'completed',
    truncated: false,
  };
}

function createVoiceTurn(
  id: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string,
  duration?: number,
): VisibleMessage {
  return {
    messageId: id,
    turnId: `turn_${id}`,
    eventId: `evt_${id}`,
    sequence: 1,
    role,
    content: '',
    createdAt,
    completionStatus: 'completed',
    truncated: false,
    mode: 'live',
    voiceSessionId: sessionId,
    voiceDurationSeconds: duration,
    voiceTranscripts: [{ role, content, createdAt }],
  };
}

describe('groupVoiceMessages', () => {
  it('passes regular text messages through untouched', () => {
    const input = [
      createTextMessage('m1', 'user', 'Hello'),
      createTextMessage('m2', 'assistant', 'Hi there!'),
    ];
    const output = groupVoiceMessages(input);
    expect(output).toEqual(input);
  });

  it('consolidates all back-and-forth turns of a single call into ONE voice call record', () => {
    const input = [
      createTextMessage('m0', 'user', 'Starting voice mode...'),
      createVoiceTurn('v1', 'call-alpha', 'user', 'Hello Aurvin', '2026-10-15T10:00:00.000Z'),
      createVoiceTurn('v2', 'call-alpha', 'assistant', 'Hello Peter, how are you?', '2026-10-15T10:00:04.000Z'),
      createVoiceTurn('v3', 'call-alpha', 'user', 'What is the distance to Mars?', '2026-10-15T10:00:10.000Z'),
      createVoiceTurn('v4', 'call-alpha', 'assistant', 'Around 225 million kilometers on average.', '2026-10-15T10:00:18.000Z'),
      createTextMessage('m5', 'user', 'Thank you!'),
    ];

    const output = groupVoiceMessages(input);

    // Should have: m0 (text), 1 consolidated voice call, m5 (text) = 3 messages total
    expect(output).toHaveLength(3);
    expect(output[0].messageId).toBe('m0');
    expect(output[2].messageId).toBe('m5');

    const voiceCall = output[1];
    expect(voiceCall.voiceSessionId).toBe('call-alpha');
    expect(voiceCall.messageId).toBe('voice_call_call-alpha');
    expect(voiceCall.voiceDurationSeconds).toBe(18); // 10:00:18 - 10:00:00 = 18s
    expect(voiceCall.voiceTranscripts).toHaveLength(4);
    expect(voiceCall.voiceTranscripts).toEqual([
      { role: 'user', content: 'Hello Aurvin', createdAt: '2026-10-15T10:00:00.000Z' },
      { role: 'assistant', content: 'Hello Peter, how are you?', createdAt: '2026-10-15T10:00:04.000Z' },
      { role: 'user', content: 'What is the distance to Mars?', createdAt: '2026-10-15T10:00:10.000Z' },
      { role: 'assistant', content: 'Around 225 million kilometers on average.', createdAt: '2026-10-15T10:00:18.000Z' },
    ]);
  });

  it('keeps separate voice calls distinct when separated by text or different session IDs', () => {
    const input = [
      createVoiceTurn('c1_1', 'call-1', 'user', 'Call 1 User', '2026-10-15T10:00:00.000Z'),
      createVoiceTurn('c1_2', 'call-1', 'assistant', 'Call 1 Assistant', '2026-10-15T10:00:05.000Z'),
      createTextMessage('text_break', 'user', 'Text between calls'),
      createVoiceTurn('c2_1', 'call-2', 'user', 'Call 2 User', '2026-10-15T10:05:00.000Z'),
      createVoiceTurn('c2_2', 'call-2', 'assistant', 'Call 2 Assistant', '2026-10-15T10:05:08.000Z'),
    ];

    const output = groupVoiceMessages(input);

    expect(output).toHaveLength(3);
    expect(output[0].voiceSessionId).toBe('call-1');
    expect(output[0].voiceTranscripts).toHaveLength(2);
    expect(output[0].voiceDurationSeconds).toBe(5);

    expect(output[1].messageId).toBe('text_break');

    expect(output[2].voiceSessionId).toBe('call-2');
    expect(output[2].voiceTranscripts).toHaveLength(2);
    expect(output[2].voiceDurationSeconds).toBe(8);
  });

  it('uses explicit duration if present on any message in the group', () => {
    const input = [
      createVoiceTurn('v1', 'call-explicit', 'user', 'Hi', '2026-10-15T10:00:00.000Z', 42),
      createVoiceTurn('v2', 'call-explicit', 'assistant', 'Hello', '2026-10-15T10:00:02.000Z'),
    ];

    const output = groupVoiceMessages(input);
    expect(output).toHaveLength(1);
    expect(output[0].voiceDurationSeconds).toBe(42);
  });

  it('retains cached duration when subsequent message arrives with undefined duration', () => {
    clearVoiceDurationsCache();
    const initial = [
      createVoiceTurn('v1', 'call-cache-test', 'assistant', '', '2026-10-15T10:00:00.000Z', 25),
    ];
    const firstOutput = groupVoiceMessages(initial);
    expect(firstOutput[0].voiceDurationSeconds).toBe(25);

    const serverUpdate = [
      createVoiceTurn('v1_server', 'call-cache-test', 'user', 'What is AI?', '2026-10-15T10:00:00.000Z'),
      createVoiceTurn('v2_server', 'call-cache-test', 'assistant', 'AI is artificial intelligence.', '2026-10-15T10:00:01.000Z'),
    ];
    const secondOutput = groupVoiceMessages(serverUpdate);
    expect(secondOutput).toHaveLength(1);
    expect(secondOutput[0].voiceDurationSeconds).toBe(25);
  });

  it('keeps completed voice turns with valid canvasArtifacts inside the consolidated call pill without leaking inline rows into the chat transcript', () => {
    clearVoiceDurationsCache();
    const chartProjection = {
      responseId: 'resp_mars_1',
      ordinal: 0,
      kind: 'chart' as const,
      subType: 'Bar Chart',
      title: 'Planet Distances',
      rawSource: '{"type":"bar","labels":["Earth","Mars"],"datasets":[{"label":"AU","data":[1,1.52]}]}',
    };
    const input: VisibleMessage[] = [
      createVoiceTurn('v1', 'call-visual', 'user', 'Compare Earth and Mars distances.', '2026-11-02T10:00:00.000Z'),
      {
        ...createVoiceTurn(
          'v2',
          'call-visual',
          'assistant',
          'Here is the orbital distance comparison between Earth and Mars.',
          '2026-11-02T10:00:12.000Z',
        ),
        canvasArtifacts: [chartProjection],
      },
      createVoiceTurn('v3', 'call-visual', 'user', 'Thanks Aurvin.', '2026-11-02T10:00:18.000Z'),
      createVoiceTurn('v4', 'call-visual', 'assistant', 'Anytime.', '2026-11-02T10:00:22.000Z'),
    ];

    const output = groupVoiceMessages(input);

    // Consolidated into 1 call pill - no leaking inline turns in the chat transcript
    expect(output).toHaveLength(1);

    const callPill = output[0];
    expect(callPill.messageId).toBe('voice_call_call-visual');
    expect(callPill.voiceSessionId).toBe('call-visual');
    expect(callPill.voiceDurationSeconds).toBe(22);
    expect(callPill.canvasArtifacts).toBeUndefined();
    expect(callPill.voiceTranscripts).toHaveLength(4);
    expect(callPill.voiceTranscripts![1]).toEqual({
      role: 'assistant',
      content: 'Here is the orbital distance comparison between Earth and Mars.',
      createdAt: '2026-11-02T10:00:12.000Z',
      canvasArtifacts: [chartProjection],
      messageId: 'v2',
    });
  });

  it('consolidates a single-turn voice call with valid canvasArtifacts into one call pill containing canvasArtifacts in its transcript items', () => {
    clearVoiceDurationsCache();
    const mermaidProjection = {
      responseId: 'resp_single_1',
      ordinal: 0,
      kind: 'mermaid' as const,
      subType: 'Flowchart',
      title: 'Cache Flow',
      rawSource: 'flowchart LR\n  API --> Cache',
    };
    const singleVisual: VisibleMessage = {
      ...createVoiceTurn(
        'v_single',
        'call-single-visual',
        'assistant',
        'Requests check the cache first.',
        '2026-11-02T11:00:00.000Z',
        9,
      ),
      canvasArtifacts: [mermaidProjection],
    };

    const output = groupVoiceMessages([singleVisual]);
    expect(output).toHaveLength(1);
    expect(output[0].messageId).toBe('voice_call_call-single-visual');
    expect(output[0].voiceDurationSeconds).toBe(9);
    expect(output[0].canvasArtifacts).toBeUndefined();
    expect(output[0].voiceTranscripts).toEqual([
      {
        role: 'assistant',
        content: 'Requests check the cache first.',
        createdAt: '2026-11-02T11:00:00.000Z',
        canvasArtifacts: [mermaidProjection],
        messageId: 'v_single',
      },
    ]);
  });

  it('ignores malformed canvasArtifacts and keeps the voice turn consolidated as a standard call pill without broken inline rows', () => {
    const malformed: VisibleMessage = {
      ...createVoiceTurn(
        'v_bad',
        'call-malformed',
        'assistant',
        'Spoken answer still works.',
        '2026-11-02T11:05:00.000Z',
        6,
      ),
      canvasArtifacts: [
        {
          responseId: 'resp_bad',
          ordinal: 99,
          kind: 'mermaid',
          subType: 'Flowchart',
          title: 'Invalid Ordinal',
          rawSource: 'flowchart TD\n  A --> B',
        },
      ],
    };

    const output = groupVoiceMessages([malformed]);
    expect(output).toHaveLength(1);
    expect(output[0].voiceSessionId).toBe('call-malformed');
    expect(output[0].canvasArtifacts).toBeUndefined();
    expect(output[0].voiceTranscripts).toEqual([
      {
        role: 'assistant',
        content: 'Spoken answer still works.',
        createdAt: '2026-11-02T11:05:00.000Z',
        canvasArtifacts: [
          {
            responseId: 'resp_bad',
            ordinal: 99,
            kind: 'mermaid',
            subType: 'Flowchart',
            title: 'Invalid Ordinal',
            rawSource: 'flowchart TD\n  A --> B',
          },
        ],
        messageId: 'v_bad',
      },
    ]);
  });

  it('preserves Calendar snapshots with original message identity inside the voice transcript',()=>{
    const grouped=groupVoiceMessages([calendarMessage(agenda(),'live')]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].voiceTranscripts?.[0]).toMatchObject({messageId:'assistant-1',turnId:'turn-1',calendarView:agenda()});
    const html=renderToStaticMarkup(createElement(VoiceTranscriptModal,{transcripts:grouped[0].voiceTranscripts!,onClose:()=>{}}));
    expect(html).toContain('View agenda in Canvas');
    expect(html).not.toContain('Confirm event');
    const fallback=groupVoiceMessages([{...calendarMessage(agenda(),'live'),voiceTranscripts:undefined}]);
    expect(fallback[0].voiceTranscripts?.[0]).toMatchObject({role:'assistant',messageId:'assistant-1',
      turnId:'turn-1',calendarView:agenda()});
  });
});
