/**
 * ============================================================================
 * FILE: canvas-artifact.spec.ts
 * LOCATION: backend/src/contracts/canvas-artifact.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for Canvas artifact schemas and their integration into message,
 *    delivery, and visible message record contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures that visual artifact projections are strictly validated, bounded,
 *    linked to valid assistant/live turns, and kept separate from speech fields.
 *
 * KEY COMPONENTS:
 *    - canvasArtifactProjectionSchema round-trip and validation
 *    - messageRecordSchema validation with optional canvasArtifacts
 *    - voiceDeliveryRecordSchema validation with matching responseId
 *    - visibleMessageSchema public projection validation
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { BSON } from 'mongodb';
import { message } from '../../test/persistence/fixtures.js';
import { deliveryFixture } from './testing/voice-fixtures.js';
import { messageRecordSchema } from './message.js';
import { visibleMessageSchema } from './api.js';
import { voiceDeliveryRecordSchema } from './voice.js';
import { canvasArtifactProjectionSchema, canvasArtifactsSchema } from './canvas-artifact.js';
import { bounded } from '../persistence/records.js';
import { DEFAULT_BUDGETS } from './budgets.js';

const visual = {
  responseId: 'response-1',
  ordinal: 0,
  kind: 'mermaid' as const,
  subType: 'Flowchart',
  title: 'Approval path',
  rawSource: 'flowchart TD\nA --> B',
};

describe('canvas artifact contracts', () => {
  it('round trips bounded visuals separately from legacy speech', () => {
    const legacy = message(2);
    expect(messageRecordSchema.parse(legacy)).toEqual(legacy);
    const assistant = {
      ...legacy,
      role: 'assistant' as const,
      attemptId: 'a1',
      visibility: 'internal' as const,
      mode: 'live' as const,
      voiceSessionId: 'voice-1',
      content: 'Clean explanation.',
      canvasArtifacts: [visual],
    };
    expect(messageRecordSchema.parse(BSON.deserialize(BSON.serialize(assistant)))).toEqual(assistant);
    expect(canvasArtifactProjectionSchema.parse(visual)).toEqual(visual);
    expect(canvasArtifactsSchema.parse([visual])).toEqual([visual]);
    const d = { ...deliveryFixture(), responseId: visual.responseId, canvasArtifacts: [visual] };
    expect(voiceDeliveryRecordSchema.parse(d).canvasArtifacts).toEqual([visual]);
    expect(messageRecordSchema.safeParse({ ...assistant, role: 'user' }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...assistant, canvasArtifacts: [] }).success).toBe(false);
    expect(voiceDeliveryRecordSchema.safeParse({ ...d, responseId: 'other' }).success).toBe(false);
    const publicValue = {
      messageId: assistant.messageId,
      turnId: assistant.turnId,
      eventId: assistant.eventId,
      sequence: assistant.sequence,
      role: 'assistant' as const,
      content: '',
      createdAt: assistant.createdAt,
      completionStatus: assistant.completionStatus,
      truncated: false,
      mode: 'live' as const,
      voiceSessionId: 'voice-1',
      canvasArtifacts: [visual],
    };
    expect(visibleMessageSchema.parse(publicValue)).toEqual(publicValue);
  });

  it('rejects invalid message roles, modes, visibilities, and attempt linkage', () => {
    const base = {
      ...message(2),
      role: 'assistant' as const,
      attemptId: 'a1',
      visibility: 'internal' as const,
      mode: 'live' as const,
      voiceSessionId: 'voice-1',
      content: 'Clean explanation.',
      canvasArtifacts: [visual],
    };

    expect(messageRecordSchema.safeParse({ ...base, role: 'user' }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...base, visibility: 'visible' }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...base, mode: 'text' }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...base, attemptId: null }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...base, voiceSessionId: undefined }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...base, voiceSessionId: 'bad id' }).success).toBe(false);
    expect(messageRecordSchema.safeParse({ ...base, extraKey: 'forbidden' }).success).toBe(false);
  });

  it('enforces descriptor bounds, sorting, and aggregate limits', () => {
    const visual1 = { ...visual, ordinal: 1, rawSource: 'flowchart TD\nC --> D' };
    const visual2 = { ...visual, ordinal: 2, rawSource: 'flowchart TD\nE --> F' };

    // Three sorted ordinals and gaps are valid
    expect(canvasArtifactsSchema.parse([visual, visual1, visual2])).toHaveLength(3);
    expect(canvasArtifactsSchema.parse([visual, visual2])).toHaveLength(2);

    // Duplicate ordinals and descending ordinals rejected
    expect(canvasArtifactsSchema.safeParse([visual, visual]).success).toBe(false);
    expect(canvasArtifactsSchema.safeParse([visual1, visual]).success).toBe(false);

    // Conflicting response IDs rejected
    expect(canvasArtifactsSchema.safeParse([visual, { ...visual1, responseId: 'other-res' }]).success).toBe(false);

    // More than 3 artifacts rejected
    const visual3 = { ...visual, ordinal: 3 };
    expect(canvasArtifactsSchema.safeParse([visual, visual1, visual2, visual3]).success).toBe(false);

    // Empty list rejected
    expect(canvasArtifactsSchema.safeParse([]).success).toBe(false);
  });

  it('verifies storage bounds using bounded helper', () => {
    const maxSourceVisual = {
      ...visual,
      rawSource: 'x'.repeat(8192),
    };
    const maxVisual2 = {
      ...visual,
      ordinal: 1,
      rawSource: 'y'.repeat(8192),
    };
    const assistant = {
      ...message(2),
      role: 'assistant' as const,
      attemptId: 'a1',
      visibility: 'internal' as const,
      mode: 'live' as const,
      voiceSessionId: 'voice-1',
      content: 'Multibyte 🌍 speech content.',
      canvasArtifacts: [maxSourceVisual, maxVisual2],
    };

    // Legal worst-case fits in default message cap
    const validated = bounded(messageRecordSchema, assistant, 'msg-1', DEFAULT_BUDGETS.maxMessageBytes).record;
    expect(validated.canvasArtifacts).toHaveLength(2);

    // Candidate one byte beyond configured limit rejects
    const exactBytes = BSON.serialize(assistant).byteLength;
    expect(() => bounded(messageRecordSchema, assistant, 'msg-1', exactBytes - 1)).toThrow();
  });
});
