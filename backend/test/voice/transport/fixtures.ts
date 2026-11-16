/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/voice/transport/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test fixtures for native WebSocket voice transport testing.
 *
 * ROLE IN PROJECT:
 *    Provides an EventEmitter-based FakeSocket and microtask settling helper
 *    to test VoiceConnection and VoiceGateway deterministically.
 *
 * KEY COMPONENTS:
 *    - FakeSocket: Mock WebSocket implementation tracking send/close calls and events.
 *    - settle(): Helper awaiting microtask resolution.
 * ============================================================================
 */

import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

export class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn((_data: string | Uint8Array) => undefined);
  close = vi.fn((_code?: number) => { this.readyState = 3; this.emit('close'); });
  terminate = vi.fn(() => { this.readyState = 3; this.emit('close'); });

  text(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  binary(bytes: Uint8Array) { this.emit('message', Buffer.from(bytes), true); }
  events() { return this.send.mock.calls.flatMap(([d]) => typeof d === 'string' ? [JSON.parse(d)] : []); }
}

export async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
