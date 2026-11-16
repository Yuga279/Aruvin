/**
 * ============================================================================
 * FILE: VoiceTranscriptModal.test.ts
 * LOCATION: frontend/src/components/VoiceTranscriptModal.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify voice duration formatting and VoiceTranscriptModal markup rendering.
 *
 * ROLE IN PROJECT:
 *    Ensures voice transcripts are formatted into normal user and assistant
 *    bubbles within a blurred modal window with keyboard and close controls.
 *
 * KEY COMPONENTS:
 *    - formatVoiceDuration: Formats raw seconds into human-readable strings.
 *    - VoiceTranscriptModal: Renders backdrop, modal window, header, and chat bubbles.
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { agenda } from '../features/canvas/testing/calendar-view-fixtures.ts';
import { formatVoiceDuration, VoiceTranscriptModal } from './VoiceTranscriptModal.tsx';

describe('formatVoiceDuration', () => {
  it('formats undefined, negative, or zero seconds as 0s', () => {
    expect(formatVoiceDuration(undefined)).toBe('0s');
    expect(formatVoiceDuration(-10)).toBe('0s');
    expect(formatVoiceDuration(0)).toBe('0s');
  });

  it('formats seconds below one minute', () => {
    expect(formatVoiceDuration(5)).toBe('5s');
    expect(formatVoiceDuration(45.4)).toBe('45s');
    expect(formatVoiceDuration(59)).toBe('59s');
  });

  it('formats exact minutes and minutes with remaining seconds', () => {
    expect(formatVoiceDuration(60)).toBe('1m');
    expect(formatVoiceDuration(65)).toBe('1m 5s');
    expect(formatVoiceDuration(125)).toBe('2m 5s');
    expect(formatVoiceDuration(3600)).toBe('60m');
  });
});

describe('VoiceTranscriptModal component markup', () => {
  it('distinguishes a generated per-message transcript from proof of heard audio', () => {
    const html = renderToStaticMarkup(createElement(VoiceTranscriptModal, {
      transcripts: [{ role: 'assistant', content: 'Generated answer.' }], onClose: () => {},
    }));
    expect(html).toContain('Voice message');
    expect(html).toContain('not proof that audio was heard');
    expect(html).not.toContain('Voice Chat · 0s');
  });
  it('renders modal with backdrop, header, title, close button, and empty state', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceTranscriptModal, {
        durationSeconds: 15,
        transcripts: [],
        onClose: () => {},
      }),
    );

    expect(html).toContain('class="aurvin-voice-modal-backdrop"');
    expect(html).toContain('class="aurvin-voice-modal-window"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Voice Chat · 15s');
    expect(html).toContain('aria-label="Close transcript"');
    expect(html).toContain('No voice conversation transcript recorded.');
  });

  it('renders back-and-forth conversation bubbles inside the modal body', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceTranscriptModal, {
        durationSeconds: 45,
        transcripts: [
          { role: 'user', content: 'What is the speed of light?' },
          { role: 'assistant', content: 'The speed of light is approximately **299,792 km/s**.' },
        ],
        onClose: () => {},
      }),
    );

    expect(html).toContain('Voice Chat · 45s');
    // User bubble
    expect(html).toContain('aurvin-message-user');
    expect(html).toContain('<div class="aurvin-bubble">What is the speed of light?</div>');
    // Assistant message
    expect(html).toContain('aurvin-message-assistant');
    expect(html).toContain('<strong>299,792 km/s</strong>');
  });

  it('renders spoken explanation and CanvasArtifactCard triggers inside the modal window for visual assistant turns', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceTranscriptModal, {
        durationSeconds: 30,
        transcripts: [
          {
            role: 'user',
            content: 'How does RAG separate meaning?',
          },
          {
            role: 'assistant',
            content: 'Documents are converted into vector embeddings.',
            canvasArtifacts: [
              {
                responseId: 'resp_rag_1',
                ordinal: 0,
                kind: 'mermaid',
                subType: 'Flowchart',
                title: 'How RAG separates meaning',
                rawSource: 'flowchart TD\n  Query --> Vector\n  Docs --> Vector',
              },
            ],
          },
        ],
        onClose: () => {},
      }),
    );

    expect(html).toContain('Voice Chat · 30s');
    expect(html).toContain('How does RAG separate meaning?');
    expect(html).toContain('Documents are converted into vector embeddings.');
    expect(html).toContain('data-canvas-artifact-id="resp_rag_1::canvas::0"');
    expect(html).toContain('How RAG separates meaning');
    expect(html).toContain('Flowchart');
    expect(html).toContain('View diagram');
  });

  it('reuses the manual Canvas card for an archived snapshot and gains nothing without original identity', () => {
    const html = renderToStaticMarkup(createElement(VoiceTranscriptModal, {
      durationSeconds: 12,
      transcripts: [{ role: 'assistant', content: 'One event.', messageId: 'assistant-1',
        turnId: 'turn-1', calendarView: agenda() }],
      onClose: () => {},
    }));
    expect(html).toContain('data-canvas-artifact-id="assistant-1::canvas::calendar"');
    expect(html).toContain('View agenda in Canvas');
    expect(html).not.toContain('Confirm event');
    const identityless = renderToStaticMarkup(createElement(VoiceTranscriptModal, {
      transcripts: [{ role: 'assistant', content: 'One event.', calendarView: agenda() }],
      onClose: () => {},
    }));
    expect(identityless).not.toContain('::canvas::calendar');
  });
});
