/**
 * ============================================================================
 * FILE: config-snapshots.spec.ts
 * LOCATION: backend/test/voice/usage/config-snapshots.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove admitted voice usage clocks, rates, and quotas survive publication.
 *
 * ROLE IN PROJECT:
 *    Guards P4 so current config edits affect new admission only, while
 *    in-flight leases keep frozen timers and accounting.
 *
 * KEY COMPONENTS:
 *    - revisionFixture: In-process current-config pointer without network.
 *    - Frozen warning/idle/rate and continuous quota cases.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { revisionFixture } from '../session/fixtures.js';
import { context, harness } from './fixtures.js';
import type { RuntimeConfigSnapshot } from '../../../src/contracts/config-runtime.js';

function bind(snapshot: RuntimeConfigSnapshot, mode: 'dictation' | 'live' = 'dictation',
  id?: string) {
  const c = context(snapshot.voice, mode, id);
  c.configSnapshot = snapshot;
  c.voiceConfig = snapshot.voice;
  return c;
}

it('keeps the admitted dictation warning and duration after publication', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.voice.limits.dictationMaxMs = 60_000; s.voice.dictationWarningMs = 40_000;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = context(old.voice, 'dictation');
  c.configSnapshot = old; c.voiceConfig = old.voice;
  await h.service.admission(c);
  r.publish(r.make(2, s => {
    s.voice.limits.dictationMaxMs = 30_000; s.voice.dictationWarningMs = null;
  }));
  h.time.advance(30_000); expect(h.stops).toEqual([]);
  h.time.advance(10_000); expect(h.warns.map(w => w.code)).toEqual(['VOICE_DURATION_LIMIT']);
  h.time.advance(20_000); expect(h.stops.map(s => s.reason)).toEqual(['duration']);
});

it('emits no dictation warning when the admitted warning is null', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.voice.limits.dictationMaxMs = 60_000; s.voice.dictationWarningMs = null;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  await h.service.admission(bind(old));
  h.time.advance(59_000);
  expect(h.warns).toEqual([]);
  h.time.advance(1_000);
  expect(h.stops.map(s => s.reason)).toEqual(['duration']);
});

it('live activity after publication retains its original informational idle warning', async () => {
  const r = revisionFixture();
  const old = r.make(1);
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = bind(old, 'live');
  await h.service.admission(c);
  r.publish(r.make(2, s => {
    s.voice.limits.idleWarningMs = 10_000; s.voice.limits.idleExitAfterWarningMs = 5_000;
  }));
  h.time.advance(50_000);
  h.service.noteActivity(c.response.sessionId);
  h.time.advance(60_000);
  expect(h.warns.map(w => w.code)).toEqual(['VOICE_IDLE_TIMEOUT']);
  h.time.advance(30_000);
  expect(h.stops).toEqual([]);
});

it('reconnect does not renew duration or admission', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.voice.limits.dictationMaxMs = 60_000; s.voice.dictationWarningMs = null;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = bind(old, 'dictation');
  await h.service.admission(c);
  h.time.advance(20_000);
  await h.service.disconnected(c);
  expect(h.service.snapshot()).toMatchObject({ sessions: 1, reconnects: 1, active: 1 });
  await expect(h.service.admission(bind(old, 'live', 'voice-session-2')))
    .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
  h.time.advance(40_000);
  expect(h.stops.map(s => s.reason)).toEqual(['duration']);
});

it('uses revision 2 duration and rates for new work', async () => {
  const r = revisionFixture();
  r.publish(r.make(1, s => {
    s.voice.limits.dictationMaxMs = 60_000; s.voice.dictationWarningMs = 40_000;
    s.deepgram.rates = { novaPerMinuteUsd: 0.01, fluxSttPerMinuteUsd: 0.01, fluxTtsPerThousandCharsUsd: 0.015 };
  }));
  const h = harness(); h.ports.currentConfig = r.port;
  const second = r.make(2, s => {
    s.voice.limits.dictationMaxMs = 30_000; s.voice.dictationWarningMs = 10_000;
    s.deepgram.rates = { novaPerMinuteUsd: 0.02, fluxSttPerMinuteUsd: 0.02, fluxTtsPerThousandCharsUsd: 0.03 };
  });
  r.publish(second);
  const c = bind(second);
  const lease = await h.service.admission(c);
  h.time.advance(10_000);
  expect(h.warns.map(w => w.code)).toEqual(['VOICE_DURATION_LIMIT']);
  await h.service.usage(c, { providerRequestId: 'tts-1', model: 'flux-haley-en',
    modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
  expect(h.service.snapshot().spendStatus).toBe('unknown');
  h.time.advance(20_000);
  expect(h.stops.map(s => s.reason)).toEqual(['duration']);
  await lease.release();
  expect(h.service.snapshot().estimatedSpendUsd).toBeCloseTo(0.03, 8);
});

it('lowered concurrency refuses fresh work while two admitted leases remain', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.voice.quotas.identityConcurrent = 2; s.voice.quotas.globalConcurrent = 2;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  await h.service.admission(bind(old, 'dictation', 'voice-session-1'));
  await h.service.admission(bind(old, 'dictation', 'voice-session-2'));
  r.publish(r.make(2, s => {
    s.voice.quotas.identityConcurrent = 1; s.voice.quotas.globalConcurrent = 1;
  }));
  await expect(h.service.admission(bind(r.port.current()!, 'dictation', 'voice-session-3')))
    .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
  expect(h.service.snapshot().active).toBe(2);
});

it('consumed daily minutes and admission timestamps survive several revisions', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => { s.chat.maxRequestsPerMinutePerUser = 1; });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const first = bind(old, 'dictation', 'voice-session-1');
  const lease = await h.service.admission(first);
  await lease.release();
  r.publish(r.make(2, s => { s.chat.maxRequestsPerMinutePerUser = 1; s.voice.limits.inputQueueMs = 800; }));
  await expect(h.service.admission(bind(r.port.current()!, 'dictation', 'voice-session-2')))
    .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
  h.time.advance(30_000);
  h.time.advance(60_000);
  const used = bind(r.port.current()!, 'dictation', 'voice-session-3');
  const second = await h.service.admission(used);
  h.time.advance(30_000);
  await second.release();
  const capped = r.make(4, s => {
    s.voice.quotas.identityDailyMinutes = 1; s.voice.quotas.globalDailyMinutes = 1;
    s.voice.dictationWarningMs = null;
  });
  r.publish(capped);
  const next = bind(capped, 'dictation', 'voice-session-4');
  await h.service.admission(next);
  h.time.advance(29_000);
  expect(h.stops).toEqual([]);
  h.time.advance(1_000);
  expect(h.stops.map(s => s.reason)).toEqual(['quota']);
});

it('lower daily cap refuses new work without stopping admitted work', async () => {
  const r = revisionFixture();
  const old = r.make(1);
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = bind(old, 'dictation');
  await h.service.admission(c);
  h.time.advance(90_000);
  r.publish(r.make(2, s => {
    s.voice.quotas.identityDailyMinutes = 1; s.voice.quotas.globalDailyMinutes = 1;
  }));
  await expect(h.service.admission(bind(r.port.current()!, 'dictation', 'voice-session-2')))
    .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
  expect(h.stops).toEqual([]);
  expect(h.service.snapshot().active).toBe(1);
});

it('increasing caps uses consumed allowance, not zero', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.voice.quotas.identityDailyMinutes = 1; s.voice.quotas.globalDailyMinutes = 1;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const first = bind(old, 'dictation', 'voice-session-1');
  const lease = await h.service.admission(first);
  h.time.advance(60_000);
  await lease.release();
  const next = r.make(2, s => {
    s.voice.quotas.identityDailyMinutes = 5; s.voice.quotas.globalDailyMinutes = 5;
    s.voice.limits.dictationMaxMs = 300_000; s.voice.dictationWarningMs = null;
  });
  r.publish(next);
  const c = bind(next, 'dictation', 'voice-session-2');
  await h.service.admission(c);
  h.time.advance(239_000);
  expect(h.stops.filter(s => s.sessionId === c.response.sessionId)).toEqual([]);
  h.time.advance(1_000);
  expect(h.stops.filter(s => s.sessionId === c.response.sessionId).map(s => s.reason)).toEqual(['quota']);
});

it('known old costs are not repriced after publication', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.deepgram.rates = { novaPerMinuteUsd: 0.01, fluxSttPerMinuteUsd: 0.01, fluxTtsPerThousandCharsUsd: 0.015 };
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = bind(old, 'live');
  const lease = await h.service.admission(c);
  await h.service.usage(c, { providerRequestId: 'tts-1', model: 'flux-haley-en',
    modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
  await lease.release();
  expect(h.service.snapshot().estimatedSpendUsd).toBeCloseTo(0.015, 8);
  r.publish(r.make(2, s => {
    s.deepgram.rates = { novaPerMinuteUsd: 0.02, fluxSttPerMinuteUsd: 0.02, fluxTtsPerThousandCharsUsd: 0.03 };
  }));
  expect(h.service.snapshot().estimatedSpendUsd).toBeCloseTo(0.015, 8);
});

it('unknown old costs remain unknown after adding rates', async () => {
  const r = revisionFixture();
  const old = r.make(1);
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = bind(old, 'live');
  await h.service.admission(c);
  await h.service.usage(c, { providerRequestId: 'tts-1', model: 'flux-haley-en',
    modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
  expect(h.service.snapshot()).toMatchObject({ spendStatus: 'unknown', estimatedSpendUsd: null });
  r.publish(r.make(2, s => {
    s.deepgram.rates = { novaPerMinuteUsd: 0.01, fluxSttPerMinuteUsd: 0.01, fluxTtsPerThousandCharsUsd: 0.015 };
  }));
  expect(h.service.snapshot()).toMatchObject({ spendStatus: 'unknown', estimatedSpendUsd: null });
});

it('keeps evicted closed-row quota evidence across revisions', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => { s.chat.maxRequestsPerMinutePerUser = 1000; });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  for (let i = 0; i < 257; i++) {
    const c = bind(old, 'dictation', `voice-session-${i}`);
    const lease = await h.service.admission(c);
    h.time.advance(1_000);
    await lease.release();
  }
  r.publish(r.make(2, s => {
    s.chat.maxRequestsPerMinutePerUser = 1000;
    s.voice.quotas.identityDailyMinutes = 4; s.voice.quotas.globalDailyMinutes = 4;
  }));
  r.publish(r.make(3, s => {
    s.chat.maxRequestsPerMinutePerUser = 1000;
    s.voice.quotas.identityDailyMinutes = 4; s.voice.quotas.globalDailyMinutes = 4;
  }));
  await expect(h.service.admission(bind(r.port.current()!, 'dictation', 'voice-session-258')))
    .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
});

it('old-day spend does not consume the next day daily cap', async () => {
  const r = revisionFixture();
  const old = r.make(1, s => {
    s.deepgram.rates = { novaPerMinuteUsd: 0.01, fluxSttPerMinuteUsd: 0.01, fluxTtsPerThousandCharsUsd: 0.015 };
    s.voice.quotas.dailySpendUsd = 0.01;
  });
  r.publish(old);
  const h = harness(); h.ports.currentConfig = r.port;
  const c = bind(old, 'live', 'voice-session-1');
  const lease = await h.service.admission(c);
  await h.service.usage(c, { providerRequestId: 'tts-1', model: 'flux-haley-en',
    modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
  await lease.release();
  h.time.advance(12 * 60 * 60 * 1000);
  const next = r.make(2, s => {
    s.deepgram.rates = { novaPerMinuteUsd: 0.01, fluxSttPerMinuteUsd: 0.01, fluxTtsPerThousandCharsUsd: 0.015 };
    s.voice.quotas.dailySpendUsd = 0.01;
  });
  r.publish(next);
  await expect(h.service.admission(bind(next, 'live', 'voice-session-2'))).resolves.toBeTruthy();
});
