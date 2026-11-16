/**
 * ============================================================================
 * FILE: calendar-fixture-sse.ts
 * LOCATION: frontend/src/features/plugins/google-calendar/testing/calendar-fixture-sse.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Shared SSE enqueue and chat-turn route helpers for the Calendar browser fixture.
 *
 * ROLE IN PROJECT:
 *    Prevents enqueue on a closed stream after the first chat turn and admits
 *    follow-up POST /turns plus GET stream paths used by an existing session.
 *
 * KEY COMPONENTS:
 *    - enqueueFixtureSse: Encode one SSE data frame, refusing a closed controller.
 *    - isChatTurnSubmitPath / isChatTurnStreamPath: Follow-up turn route matchers.
 * ============================================================================
 */

export function enqueueFixtureSse(
  controller: ReadableStreamDefaultController<Uint8Array> | null,
  encoder: TextEncoder,
  envelope: object,
): void {
  if (controller === null) {
    throw new Error('Calendar fixture stream is not open');
  }
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
  } catch {
    throw new Error('Calendar fixture stream is not open');
  }
}

export function isChatTurnSubmitPath(method: string, path: string): boolean {
  return method === 'POST' && /^\/api\/sessions\/[^/]+\/turns$/.test(path);
}

export function isChatTurnStreamPath(method: string, path: string): boolean {
  return method === 'GET' && /^\/api\/sessions\/[^/]+\/turns\/[^/]+\/stream$/.test(path);
}
