/**
 * ============================================================================
 * FILE: audio-capture-processor.test.ts
 * LOCATION: frontend/src/features/voice/audio/audio-capture-processor.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for AudioCaptureProcessor AudioWorklet implementation.
 *
 * ROLE IN PROJECT:
 *    Verifies source mute behavior, transferable PCM array buffers, tail draining,
 *    revision fencing, pending message bounds/overflow handling, and the opt-in
 *    live speech gate without changing dictation drain semantics.
 *
 * KEY COMPONENTS:
 *    - it('drops muted samples...'): Tests full worklet lifecycle and message exchange.
 *    - liveProcessor: Isolated live-gate worklet harness with a stubbed VAD.
 * ============================================================================
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const vadMock = vi.hoisted(() => ({
  decisions: vi.fn(() => [false, false, false, false]), reset: vi.fn(), destroy: vi.fn(),
  create: vi.fn(),
}))
vi.mock('./audio-capture-vad', () => ({ createCaptureVad: vadMock.create }))
type Message = { type: string; revision: number; pcm?: ArrayBuffer; flags?: 0 | 1 }
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
beforeEach(() => {
  vi.clearAllMocks()
  vadMock.create.mockResolvedValue(vadMock)
  vadMock.decisions.mockReturnValue([false, false, false, false])
})

async function liveProcessor() {
  type GateMessage = { type: string; revision: number; state?: string; code?: string;
    pcm?: ArrayBuffer; flags?: 0 | 1 }
  const sent: GateMessage[] = []
  class Base {
    port = { onmessage: null as null | ((e: MessageEvent) => void),
      postMessage: (message: GateMessage) => { sent.push(message) } }
  }
  vi.stubGlobal('AudioWorkletProcessor', Base)
  vi.stubGlobal('sampleRate', 16000)
  vi.stubGlobal('registerProcessor', vi.fn())
  const { AudioCaptureProcessor } = await import('./audio-capture-processor')
  const processor = new AudioCaptureProcessor({ processorOptions: { maxPendingMs: 1000, speechGate: true } })
  const command = (data: unknown) => processor.port.onmessage!({ data } as MessageEvent)
  return { sent, processor, command }
}
it('drops muted samples, transfers bounded frames and drains a real tail', async () => {
  const sent: Message[] = []
  const transfers: unknown[][] = []
  class Base {
    port = { onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage: (message: Message, transfer: unknown[] = []) => {
        sent.push(message); transfers.push(transfer)
      } }
  }
  vi.stubGlobal('AudioWorkletProcessor', Base)
  vi.stubGlobal('sampleRate', 48000)
  const register = vi.fn()
  vi.stubGlobal('registerProcessor', register)
  const { AudioCaptureProcessor } = await import('./audio-capture-processor')
  const p = new AudioCaptureProcessor({ processorOptions: { maxPendingMs: 1000 } })
  const command = (data: unknown) => p.port.onmessage!({ data } as MessageEvent)
  const block = () => p.process([[new Float32Array(128).fill(0.5)]])
  for (let i = 0; i < 30; i++) block()
  expect(sent).toHaveLength(0)
  command({ type: 'reset', revision: 1, muted: false })
  for (let i = 0; i < 30; i++) block()
  const frame = sent.find(m => m.type === 'frame')!
  expect(frame.pcm?.byteLength).toBe(2560)
  expect(transfers[sent.indexOf(frame)]).toEqual([frame.pcm])
  command({ type: 'reset', revision: 2, muted: true })
  for (let i = 0; i < 30; i++) block()
  command({ type: 'reset', revision: 3, muted: false })
  block()
  command({ type: 'drain', revision: 3 })
  expect(sent.at(-1)).toMatchObject({ type: 'frame', revision: 3, flags: 1 })
  expect(sent.at(-1)!.pcm!.byteLength).toBe(86)
  command({ type: 'reset', revision: 4, muted: false })
  for (let i = 0; i < 390; i++) block()
  expect(sent.filter(m => m.type === 'frame' && m.revision === 4)).toHaveLength(12)
  expect(sent.at(-1)).toMatchObject({ type: 'overflow', revision: 4 })
  command({ type: 'ack', revision: 4 })
  for (let i = 0; i < 30; i++) block()
  expect(sent.at(-1)?.type).toBe('overflow')
  expect(register).toHaveBeenCalledWith('aurvin-capture', AudioCaptureProcessor)
})

it('updates maxFrames on a valid reset ceiling and keeps the previous ceiling when malformed', async () => {
  const sent: Message[] = []
  class Base {
    port = { onmessage: null as null | ((e: { data: unknown }) => void),
      postMessage: (message: Message) => { sent.push(message) } }
  }
  vi.stubGlobal('AudioWorkletProcessor', Base)
  vi.stubGlobal('sampleRate', 48000)
  vi.stubGlobal('registerProcessor', vi.fn())
  const { AudioCaptureProcessor } = await import('./audio-capture-processor')
  const p = new AudioCaptureProcessor({ processorOptions: { maxPendingMs: 1000 } })
  const command = (data: unknown) => p.port.onmessage!({ data } as MessageEvent)
  const block = () => p.process([[new Float32Array(128).fill(0.5)]])
  command({ type: 'reset', revision: 1, muted: false, maxPendingMs: 800 })
  expect(sent.at(-1)).toMatchObject({ type: 'reset', revision: 1 })
  for (let i = 0; i < 390; i++) block()
  expect(sent.filter(m => m.type === 'frame' && m.revision === 1)).toHaveLength(10)
  expect(sent.at(-1)).toMatchObject({ type: 'overflow', revision: 1 })
  command({ type: 'reset', revision: 2, muted: false, maxPendingMs: 0 })
  expect(sent.at(-1)).toMatchObject({ type: 'reset', revision: 2 })
  for (let i = 0; i < 390; i++) block()
  expect(sent.filter(m => m.type === 'frame' && m.revision === 2)).toHaveLength(10)
  expect(sent.at(-1)).toMatchObject({ type: 'overflow', revision: 2 })
})

it('live gate stops quiet PCM but keeps scoring and resumes only on upload acknowledgement', async () => {
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  await Promise.resolve(); await Promise.resolve()
  expect(sent).toContainEqual({ type: 'gate-ready', revision: 0 })
  command({ type: 'reset', revision: 1, muted: false, uploading: true })
  for (let i = 0; i < 2250; i++) {
    processor.process([[new Float32Array(1280)]])
    command({ type: 'ack', revision: 1 })
  }
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(62)
  expect(sent.filter(m => m.type === 'gate')).toEqual([{ type: 'gate', revision: 1, state: 'suspended' }])
  expect(vadMock.decisions).toHaveBeenCalledTimes(2250)
  vadMock.decisions.mockReturnValue([true, false, false, false])
  processor.process([[new Float32Array(1280)]])
  expect(sent.at(-1)).toMatchObject({ type: 'gate', state: 'speech' })
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(62)
  command({ type: 'upload', revision: 0, enabled: true })
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(62)
  command({ type: 'upload', revision: 1, enabled: true })
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(66)
})

it('mute/destroy discard pre-roll and a late detector cannot revive capture', async () => {
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  await Promise.resolve(); await Promise.resolve()
  command({ type: 'reset', revision: 2, muted: true, uploading: false })
  const count = sent.filter(m => m.type === 'frame').length
  command({ type: 'upload', revision: 1, enabled: true })
  processor.process([[new Float32Array(1280)]])
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(count)
  command({ type: 'destroy', revision: 2 })
  expect(vadMock.destroy).toHaveBeenCalledTimes(1)
})

it('detector startup rejection emits MEDIA_GATE_UNAVAILABLE without frames or private detail', async () => {
  vadMock.create.mockRejectedValueOnce(new Error('private WASM error'))
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  await Promise.resolve(); await Promise.resolve()
  for (let i = 0; i < 100; i++) processor.process([[new Float32Array(1280)]])
  expect(sent).toEqual([{ type: 'gate-error', revision: 0, code: 'MEDIA_GATE_UNAVAILABLE' }])
  expect(JSON.stringify(sent)).not.toContain('private WASM error')
})

it('detector destroy before init resolution sends no gate-ready or frames', async () => {
  let resolveVad!: (value: typeof vadMock) => void
  vadMock.create.mockImplementationOnce(() => new Promise(resolve => { resolveVad = resolve }))
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  command({ type: 'destroy', revision: 0 })
  resolveVad(vadMock)
  await Promise.resolve(); await Promise.resolve()
  processor.process([[new Float32Array(1280)]])
  expect(vadMock.destroy).toHaveBeenCalledTimes(1)
  expect(sent.filter(m => m.type === 'gate-ready' || m.type === 'frame')).toEqual([])
})

it('detector process failure is fail-closed as MEDIA_GATE_UNAVAILABLE', async () => {
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  await Promise.resolve(); await Promise.resolve()
  command({ type: 'reset', revision: 1, muted: false, uploading: true })
  vadMock.decisions.mockImplementationOnce(() => { throw new Error('private detector fault') })
  processor.process([[new Float32Array(1280)]])
  expect(sent.filter(m => m.type === 'gate-error')).toEqual([
    { type: 'gate-error', revision: 1, code: 'MEDIA_GATE_UNAVAILABLE' },
  ])
  expect(sent.filter(m => m.type === 'frame')).toEqual([])
  expect(JSON.stringify(sent)).not.toContain('private detector fault')
})

it('real embedded detector gates silence and wakes the worklet on a synthetic voiced fixture', async () => {
  const actual = await vi.importActual<typeof import('./audio-capture-vad')>('./audio-capture-vad')
  vadMock.create.mockImplementationOnce(actual.createCaptureVad)
  const { sent, processor, command } = await liveProcessor()
  command({ type: 'initialize', revision: 0 })
  await vi.waitFor(() => expect(sent).toContainEqual({ type: 'gate-ready', revision: 0 }))
  command({ type: 'reset', revision: 1, muted: false, uploading: true })
  for (let i = 0; i < 80; i++) {
    processor.process([[new Float32Array(1280)]])
    command({ type: 'ack', revision: 1 })
  }
  expect(sent.filter(m => m.type === 'gate')).toEqual([{ type: 'gate', revision: 1, state: 'suspended' }])
  const before = sent.filter(m => m.type === 'frame').length
  const voiced = Float32Array.from({ length: 1280 }, (_, i) =>
    0.3 * (Math.sin(2 * Math.PI * 140 * i / 16000) + 0.35 * Math.sin(2 * Math.PI * 280 * i / 16000)))
  // At most eight frames, below the negotiated ACK queue ceiling.
  for (let i = 0; i < 8; i++) processor.process([[voiced]])
  expect(sent.filter(m => m.type === 'gate' && m.state === 'speech')).toHaveLength(1)
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(before)
  command({ type: 'destroy', revision: 1 })
  processor.process([[voiced]])
  expect(sent.filter(m => m.type === 'frame')).toHaveLength(before)
})

