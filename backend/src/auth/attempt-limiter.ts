/**
 * ============================================================================
 * FILE: attempt-limiter.ts
 * LOCATION: backend/src/auth/attempt-limiter.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Admit a finite number of login and recovery attempts in-process.
 *
 * ROLE IN PROJECT:
 *    Bounds auth mutation traffic without a rate-limit service, never evicting
 *    a live blocked key and never signaling whether an account exists.
 *
 * KEY COMPONENTS:
 *    - take: Per-normalized-email login/recovery windows.
 *    - takeGlobal: Process-wide 60/60s mutation ceiling.
 * ============================================================================
 */

import { AuthFault } from './errors.js';
export class AttemptLimiter {
  private readonly keys = new Map<string, number[]>();
  private readonly global: number[] = [];
  constructor(private readonly now: () => number = Date.now) {}
  takeGlobal(): void {
    const now = this.now(); while (this.global.length && now - this.global[0]! >= 60000) this.global.shift();
    if (this.global.length >= 60) throw new AuthFault('RATE_LIMITED'); this.global.push(now);
  }
  take(kind: 'login' | 'recovery', email: string): void {
    const now = this.now();
    for (const [key, hits] of this.keys) {
      while (hits.length && now - hits[0]! >= 60000) hits.shift();
      if (!hits.length) this.keys.delete(key);
    }
    const key = `${kind}:${email.trim().toLowerCase()}`;
    if (!this.keys.has(key) && this.keys.size >= 1024) throw new AuthFault('RATE_LIMITED');
    const hits = this.keys.get(key) ?? [];
    if (hits.length >= (kind === 'login' ? 10 : 3)) throw new AuthFault('RATE_LIMITED');
    hits.push(now); this.keys.set(key, hits);
  }
}
