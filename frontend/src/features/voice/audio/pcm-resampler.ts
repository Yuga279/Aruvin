/**
 * ============================================================================
 * FILE: pcm-resampler.ts
 * LOCATION: frontend/src/features/voice/audio/pcm-resampler.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Stateful anti-alias FIR filter and fractional-rate resampler to 16 kHz LE PCM.
 *
 * ROLE IN PROJECT:
 *    Resamples native browser microphone streams (e.g. 44.1 kHz, 48 kHz) into
 *    standard 16 kHz 16-bit little-endian mono PCM frames (80 ms / 1280 samples).
 *
 * KEY COMPONENTS:
 *    - PcmResampler: Class managing FIR history, sample decimation/interpolation,
 *      channel downmixing, signed 16-bit LE packing, and tail draining.
 * ============================================================================
 */

export class PcmResampler {
  private readonly taps: Float64Array
  private readonly history = new Float64Array(63)
  private head = 0
  private index = 0
  private outputIndex = 0
  private previous = 0
  private frame = new Uint8Array(2560)
  private used = 0
  private readonly rate: number
  private readonly emit: (pcm: Uint8Array) => void

  constructor(rate: number, emit: (pcm: Uint8Array) => void) {
    if (!Number.isFinite(rate) || rate < 16000 || rate > 192000) throw new Error('UNSUPPORTED_AUDIO')
    this.rate = rate
    this.emit = emit
    // ponytail: fixed 63-tap FIR targets 44.1/48 kHz speech; validate other admitted rates and upgrade filter length only if measured stopband/fidelity needs it.
    const cutoff = 6800 / rate
    const taps = Float64Array.from({ length: 63 }, (_, i) => {
      const x = i - 31
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
      return sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / 62))
    })
    const sum = taps.reduce((a, b) => a + b, 0)
    this.taps = taps.map(t => t / sum)
  }

  push(channels: Float32Array[]) {
    if (!channels.length) return
    for (let i = 0; i < channels[0].length; i++) {
      let input = 0
      for (const channel of channels) input += Number.isFinite(channel[i]) ? channel[i] : 0
      this.history[this.head] = input / channels.length
      let filtered = 0
      for (let t = 0; t < 63; t++) filtered += this.taps[t] * this.history[(this.head - t + 63) % 63]
      this.head = (this.head + 1) % 63
      const position = this.outputIndex * this.rate / 16000
      if (position <= this.index) {
        const fraction = this.index === 0 ? 1 : position - (this.index - 1)
        const s = Math.max(-1, Math.min(1, this.previous + (filtered - this.previous) * fraction))
        new DataView(this.frame.buffer).setInt16(this.used, Math.round(s * (s < 0 ? 32768 : 32767)), true)
        this.used += 2
        this.outputIndex++
        if (this.used === 2560) {
          this.emit(this.frame)
          this.frame = new Uint8Array(2560)
          this.used = 0
        }
      }
      this.previous = filtered
      this.index++
    }
  }

  drain() {
    const tail = this.frame.slice(0, this.used)
    this.frame = new Uint8Array(2560)
    this.used = 0
    return tail
  }

  reset() {
    this.history.fill(0)
    this.head = 0
    this.index = 0
    this.outputIndex = 0
    this.previous = 0
    this.frame = new Uint8Array(2560)
    this.used = 0
  }
}
