/**
 * ============================================================================
 * FILE: voice-fixtures.test.ts
 * LOCATION: frontend/src/api/testing/voice-fixtures.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify deterministic fixture factories and portable source parity on frontend.
 *
 * ROLE IN PROJECT:
 *    Ensures that browser fixtures correctly mirror shared test structures and that
 *    portable protocol and codec files maintain byte-for-byte implementation parity.
 *
 * KEY COMPONENTS:
 *    - Portable fixture round-trip and validation tests
 *    - Cross-package source parity verification
 * ============================================================================
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeVoiceAudio, encodeVoiceAudio } from '../voice-audio'
import { VoiceControlReassembler, encodeVoiceControlPackets, parseVoiceControl } from '../voice-protocol'
import { goldenInputFrame, goldenOutputFrame, clientControls, serverControls, largeCanvasArtifactFixture } from './voice-fixtures'

describe('frontend shared voice fixtures', () => {
  it('validates independent golden frames and every portable event', () => {
    expect(encodeVoiceAudio(decodeVoiceAudio(goldenInputFrame()))).toEqual(goldenInputFrame())
    expect(decodeVoiceAudio(goldenOutputFrame()).kind).toBe(2)
    for (const row of clientControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'client', row.mode)).toEqual(row.event)
    for (const row of serverControls()) expect(parseVoiceControl(JSON.stringify(row.event), 'server', row.mode)).toEqual(row.event)
    const large = largeCanvasArtifactFixture()
    const packets = encodeVoiceControlPackets(large, 'server', 'live')
    expect(packets.length).toBe(2)
    const rx = new VoiceControlReassembler('server', 'live', { sessionId: large.sessionId, connectionEpoch: large.connectionEpoch })
    expect(rx.push(packets[0], 0).status).toBe('partial')
    expect(rx.push(packets[1], 10)).toMatchObject({ status: 'complete', event: large, chunked: true })
  })
  it('keeps portable production sources in exact parity excluding file headers', () => {
    // The Calendar extension is server-validated with zod schemas that the browser
    // cannot import; its local guard mirror is covered by voice-protocol.test.ts.
    const stripCalendarExtension = (source: string) => source
      .replace(/^import \{ calendarPresentationEventSchema[\s\S]*?from '\.\/calendar-wire\.js';\n/m, '')
      .replace(/^import \{ calendarCanonicalIdSchema[\s\S]*?from '\.\/calendar-discovery\.js';\n/m, '')
      .replace(/^import \{\n  isCalendarPresentationEvent,\n  type CalendarPresentationEvent,\n\} from '\.\/calendar-protocol\.ts';\n/m, '')
      .replace(/^  'calendar\.confirm': \{[\s\S]*?\},\n/m, '')
      .replace(/^  'calendar\.frame': \{[\s\S]*?\},\n/m, '')
    const body = (url: URL) => stripCalendarExtension(readFileSync(url, 'utf8')
      .replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').replace(/\r\n/g, '\n').trim())
    expect(body(new URL('../voice-protocol.ts', import.meta.url))).toBe(
      body(new URL('../../../../backend/src/contracts/voice-wire.ts', import.meta.url)))
    expect(body(new URL('../voice-audio.ts', import.meta.url))).toBe(
      body(new URL('../../../../backend/src/contracts/voice-audio.ts', import.meta.url)))
  })
})
