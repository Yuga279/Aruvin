/**
 * ============================================================================
 * FILE: audio-playback-service.test.ts
 * LOCATION: frontend/src/features/voice/audio/audio-playback-service.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for browser AudioPlaybackService 24 kHz scheduler.
 *
 * ROLE IN PROJECT:
 *    Verifies audio buffer node scheduling, played-sample calculation (audible
 *    clock vs idle time), cancellation/interrupt, queue overflow detection,
 *    and gesture unlock requirements.
 *
 * KEY COMPONENTS:
 *    - it('schedules 24 kHz PCM...'): Tests audio scheduling and progress tracking.
 *    - it('stops immediately...'): Tests immediate stop and cursor preservation.
 *    - it('decodes little endian...'): Tests LE unpacking and queue limits.
 *    - it('requires a running gesture-unlocked context...'): Tests unlock gate.
 * ============================================================================
 */

import { expect, it } from 'vitest'
import { AudioPlaybackService } from './audio-playback-service'
import { FakeContext } from './testing/audio-fakes'

const pcm = (samples: number) => new Uint8Array(samples * 2)

it('schedules 24 kHz PCM, counts played not received, and ignores idle time', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) })
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 100, pcm: pcm(2400) })
  expect(context.sources.map(n => n.start.mock.calls[0][0])).toEqual([0.1, 0.2])
  expect(playback.progress().playedSamples).toBe(0)
  context.currentTime = 0.05
  expect(playback.progress().playedSamples).toBe(0)
  context.currentTime = 0.15
  expect(playback.progress()).toMatchObject({ playedSamples: 1200, playedMs: 50 })
  context.currentTime = 0.35
  expect(playback.progress().playedMs).toBe(200)
  context.currentTime = 10
  expect(playback.progress().playedMs).toBe(200)
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 2, offsetMs: 200, pcm: pcm(2400) })
  context.currentTime = 10.05
  expect(playback.progress().playedMs).toBe(250)
})
it('stops immediately, preserves cursor, drops cancelled frames, and resets only explicitly', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock(); playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(4800) })
  context.currentTime = 0.15
  expect(playback.interrupt()).toMatchObject({ turnId: 't1', responseId: 'r1', playedMs: 50 })
  expect(context.sources[0].stop).toHaveBeenCalledTimes(1)
  expect(context.sources[0].disconnect).toHaveBeenCalledTimes(1)
  expect(playback.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 200, pcm: pcm(2400) })).toBe(false)
  playback.begin('t2', 'r2')
  playback.enqueue('r2', { kind: 2, flags: 0, sequence: 2, offsetMs: 200, pcm: pcm(2400) })
  expect(playback.progress().playedMs).toBe(50)
  context.currentTime = 0.30
  expect(playback.progress().playedMs).toBe(250)
  playback.resetOrigin()
  expect(playback.progress().playedMs).toBe(0)
  await playback.dispose(); await playback.dispose()
  expect(context.close).toHaveBeenCalledTimes(1)
})
it('decodes little endian, enforces two seconds of pending output and retains actual drain', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext(), 2000)
  await playback.unlock(); playback.begin('t1', 'r1')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0,
    pcm: new Uint8Array([0, 128, 255, 127]) })
  expect([...context.sources[0].buffer!.getChannelData(0)]).toEqual([-1, 1])
  playback.resetOrigin(); playback.begin('t2', 'r2')
  for (let i = 0; i < 10; i++) playback.enqueue('r2', {
    kind: 2, flags: 0, sequence: i, offsetMs: i * 200, pcm: pcm(4800) })
  expect(() => playback.enqueue('r2', { kind: 2, flags: 0, sequence: 10,
    offsetMs: 2000, pcm: pcm(4800) })).toThrow('AUDIO_BUFFER_OVERFLOW')
  expect(context.sources.every(n => n.stop.mock.calls.length === 1)).toBe(true)
  playback.begin('t3', 'r3')
  playback.enqueue('r3', { kind: 2, flags: 0, sequence: 11, offsetMs: 2200, pcm: pcm(2400) })
  playback.end('r3')
  expect(playback.isDrained()).toBe(false)
  context.currentTime = 0.2
  expect(playback.isDrained()).toBe(true)
})
it('requires a running gesture-unlocked context and does not advance with a suspended context', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  playback.begin('t', 'r')
  expect(() => playback.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0,
    pcm: pcm(2400) })).toThrow('PLAYBACK_BLOCKED')
  await playback.unlock()
  playback.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) })
  expect(playback.progress().playedMs).toBe(0)
  context.state = 'suspended'
  expect(playback.progress().playedMs).toBe(0)
})

it('configures the session queue only while idle after unlock', async () => {
  const context = new FakeContext(), playback = new AudioPlaybackService(() => context.asContext())
  await playback.unlock()
  playback.configureSessionQueue(400)
  playback.begin('t1', 'r1')
  expect(() => playback.configureSessionQueue(400)).toThrow('VOICE_INVALID_STATE')
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(4800) })
  playback.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 200, pcm: pcm(4800) })
  expect(() => playback.enqueue('r1', { kind: 2, flags: 0, sequence: 2, offsetMs: 400, pcm: pcm(2) }))
    .toThrow('AUDIO_BUFFER_OVERFLOW')
  const queued = new AudioPlaybackService(() => new FakeContext().asContext())
  await queued.unlock()
  queued.begin('t1', 'r1')
  queued.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) })
  expect(() => queued.configureSessionQueue(400)).toThrow('VOICE_INVALID_STATE')
})

it('reserves 100ms once per response independently of its explicit sample origin', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext())
  await p.unlock(); p.begin('t1', 'r1', 0)
  p.enqueue('r1', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(600) })
  p.enqueue('r1', { kind: 2, flags: 0, sequence: 1, offsetMs: 25, pcm: pcm(2400) })
  expect(context.sources.map(n => n.start.mock.calls[0][0])).toEqual([0.1, 0.125])
  context.currentTime = 0.099
  expect(p.progress().playedSamples).toBe(0)
  context.currentTime = 0.125
  expect(p.progress().playedSamples).toBe(600)
  expect(p.observations()).toEqual({ turnId: 't1', responseId: 'r1',
    startupReserveMs: 100, underruns: 0, underrunMs: 0 })
  p.interrupt(); p.begin('t2', 'r2', 3000)
  p.enqueue('r2', { kind: 2, flags: 0, sequence: 2, offsetMs: 125, pcm: pcm(4800) })
  expect(context.sources[2].start.mock.calls[0][0]).toBe(0.225)
  expect(p.observations().startupReserveMs).toBe(100) // Long initial packet still gets one reserve.
})

it('absorbs recoverable delivery jitter without inserting packet or sentence gaps', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext())
  await p.unlock(); p.begin('t', 'r')
  for (const [i, at] of [0, 0.19, 0.2, 0.39].entries()) {
    context.currentTime = at
    p.enqueue('r', { kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: pcm(2400) })
  }
  const starts = context.sources.map(n => n.start.mock.calls[0][0] as number)
  for (let i = 0; i < starts.length; i++) expect(starts[i]).toBeCloseTo(0.1 + i * 0.1, 9)
  expect(p.observations()).toMatchObject({ startupReserveMs: 100, underruns: 0, underrunMs: 0 })
  p.end('r'); context.currentTime = 0.5
  expect(p.isDrained()).toBe(true)
  expect(p.progress()).toMatchObject({ playedSamples: 9600, playedMs: 400, consumedSamples: 9600 })
})

it('reports actual scheduler starvation instead of hiding it with another startup delay', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext())
  await p.unlock(); p.begin('t', 'r')
  for (const [i, at] of [0, 0.25, 0.26].entries()) {
    context.currentTime = at
    p.enqueue('r', { kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: pcm(2400) })
  }
  const starts = context.sources.map(n => n.start.mock.calls[0][0] as number)
  expect(starts[0]).toBeCloseTo(0.1, 9)
  expect(starts[1]).toBeCloseTo(0.25, 9)
  expect(starts[2]).toBeCloseTo(0.35, 9)
  expect(p.observations()).toMatchObject({ startupReserveMs: 100, underruns: 1, underrunMs: 50 })
})

it('keeps bursty PCM sample-contiguous and stops reserved audio before it is audible', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext(), 400)
  await p.unlock(); p.begin('t1', 'r1')
  for (let i = 0; i < 4; i++) p.enqueue('r1', {
    kind: 2, flags: 0, sequence: i, offsetMs: i * 100, pcm: pcm(2400) })
  const starts = context.sources.map(n => n.start.mock.calls[0][0] as number)
  for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(0.1, 9)
  context.currentTime = 0.05
  expect(p.interrupt()).toMatchObject({ playedSamples: 0, consumedSamples: 0 })
  expect(context.sources.every(n => n.stop.mock.calls.length === 1)).toBe(true)
  expect(p.enqueue('r1', { kind: 2, flags: 0, sequence: 4, offsetMs: 400, pcm: pcm(2400) })).toBe(false)
  expect(p.isDrained()).toBe(true)
  p.begin('t2', 'r2', 9600)
  p.enqueue('r2', { kind: 2, flags: 0, sequence: 5, offsetMs: 400, pcm: pcm(1) })
  context.currentTime = 0.15
  expect(p.progress()).toMatchObject({ playedSamples: 9600, consumedSamples: 0 })
  context.currentTime = 0.15 + 1 / 24000
  expect(p.progress()).toMatchObject({ playedSamples: 9601, consumedSamples: 1 })
})

it('preserves PCM silence and never substitutes reserve time for sample evidence', async () => {
  const context = new FakeContext(), p = new AudioPlaybackService(() => context.asContext())
  await p.unlock(); p.begin('t', 'r')
  p.enqueue('r', { kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: pcm(2400) })
  expect([...context.sources[0].buffer!.getChannelData(0)].every(n => n === 0)).toBe(true)
  context.currentTime = 0.1
  expect(p.progress().playedSamples).toBe(0)
  context.currentTime = 0.1 + 2399 / 24000
  expect(p.progress().playedSamples).toBe(2399)
  context.currentTime = 0.2
  expect(p.progress().playedSamples).toBe(2400)
  expect(p.observations().underruns).toBe(0)
})
