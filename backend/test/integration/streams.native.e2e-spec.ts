/**
 * ============================================================================
 * FILE: streams.native.e2e-spec.ts
 * LOCATION: backend/test/integration/streams.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC02 progressive delivery and AC11 honest terminal outcomes.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that completed, truncated, error, EOF, missing usage, and
 *    cancel are distinct, and that the first loopback chunk arrives early.
 *
 * KEY COMPONENTS:
 *    - turn(): One assembled stream plus durable status for a fixture.
 *    - delayedFrames: First-byte proof without treating cancel as zero cost.
 * ============================================================================
 */

import { catalogueResponse, delayedFrames, FRAMES, listen, openAssembled, parseEvents, readFirstChunk, submit, streamText } from './assembled-harness.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

async function turn(frames: string) {
  const h = await openAssembled({ frames });
  const accepted = await submit(h.agent, 'Stream outcome', 'p10-stream-request-1');
  const text = await streamText(h.agent, accepted);
  const status = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
  return { h, accepted, events: parseEvents(text), status: status.body as { status: string; truncated: boolean; error: { message: string } | null } };
}

nativeIt('AC02 normal stream finalizes before completed', async () => {
  const result = await turn(FRAMES.normal);
  try {
    const types = result.events.map((event) => event.event.type);
    expect(types).toContain('turn-accepted');
    expect(types).toContain('delta');
    expect(types.indexOf('status')).toBeLessThan(types.lastIndexOf('completed'));
    expect(result.status).toMatchObject({ status: 'completed', truncated: false });
    const assistant = await result.h.db.db.collection(COLLECTIONS.messages).findOne({ role: 'assistant' });
    expect(assistant?.completionStatus).toBe('completed');
  } finally { await result.h.close(); }
}, 60000);

nativeIt('AC11 length truncation is not ordinary completion', async () => {
  const result = await turn(FRAMES.length);
  try {
    const completed = result.events.find((event) => event.event.type === 'completed');
    expect(completed?.event.type === 'completed' ? completed.event.outcome : result.status.status).not.toBe('completed');
    expect(result.status.truncated || result.status.status === 'truncated').toBe(true);
  } finally { await result.h.close(); }
}, 60000);

nativeIt('AC11 HTTP-200 error and EOF are not completion', async () => {
  for (const frames of [FRAMES.errorBefore, FRAMES.errorAfter, FRAMES.eof]) {
    const result = await turn(frames);
    try {
      expect(result.events.some((event) => event.event.type === 'completed')).toBe(false);
      expect(result.status.status).not.toBe('completed');
      expect(JSON.stringify(result.status)).not.toContain('private provider detail');
    } finally { await result.h.close(); }
  }
}, 60000);

nativeIt('AC11 missing usage stays null', async () => {
  const result = await turn(FRAMES.noUsage);
  try {
    for (const event of result.events) {
      if (event.event.type === 'usage') expect(event.event.cost).toBeNull();
    }
    const accounting = await result.h.db.db.collection(COLLECTIONS.metadata).findOne({ kind: 'accounting' });
    expect(accounting?.cost ?? null).toBeNull();
  } finally { await result.h.close(); }
}, 60000);

nativeIt('AC02 first loopback chunk arrives before completion', async () => {
  const h = await openAssembled({ fetcher: async (url) => {
    if (String(url).endsWith('/models')) return catalogueResponse();
    return new Response(delayedFrames(), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'Progressive', 'p10-progress-request');
    const server = await listen(h.app);
    const first = await readFirstChunk(server.port, `/api${accepted.streamPath}`);
    expect(first).toContain('Hello');
    expect(first).not.toContain('"type":"completed"');
  } finally { await h.close(); }
}, 60000);

nativeIt('AC11 cancel is terminal and not a billing guarantee', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = await openAssembled({ fetcher: async (url) => {
    if (String(url).endsWith('/models')) return catalogueResponse();
    await gate;
    return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'Cancel me', 'p10-cancel-request-1');
    const pending = h.agent.get(`/api${accepted.streamPath}`);
    await h.agent.post(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}/cancel`)
      .send({ attemptId: accepted.attemptId }).expect(204);
    release();
    await pending;
    const status = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(status.body.status).toBe('cancelled');
    expect(status.body.status).not.toBe('completed');
  } finally { release(); await h.close(); }
}, 60000);
