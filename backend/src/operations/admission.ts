/**
 * ============================================================================
 * FILE: admission.ts
 * LOCATION: backend/src/operations/admission.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bound shared-identity generation and control request rates.
 *
 * ROLE IN PROJECT:
 *    Applies a sliding one-minute window to inference-starting traffic and a
 *    separate control/read reserve so cancel/status/health remain available.
 *
 * KEY COMPONENTS:
 *    - Admission.take: Finite generation and control arrays, no identity maps.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';
export class Admission {
  private generation:number[]=[];
  private control:number[]=[];
  constructor(private maximum:number | (() => number)) {}
  take(kind:'generation'|'control',now:number) {
    // Resolve the live ceiling on every take so config edits apply to new
    // work without reconstructing this instance or clearing its history.
    const generationCap = typeof this.maximum === 'function' ? this.maximum() : this.maximum;
    const cap=kind === 'generation' ? generationCap : 120;
    const retained=this[kind].filter(at => now-at < 60000);
    this[kind]=retained;
    if (retained.length >= cap) throw new AppError('RATE_LIMITED','Too many requests. Wait and try again.');
    retained.push(now);
  }
}
