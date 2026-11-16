/**
 * ============================================================================
 * FILE: admission.spec.ts
 * LOCATION: backend/test/operations/admission.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove generation windows, expiry, and independent control caps.
 *
 * ROLE IN PROJECT:
 *    Locks the shared-identity rate boundary so stream GET counts as admission
 *    while cancel/read/health keep a reserved control budget.
 *
 * KEY COMPONENTS:
 *    - Generation window: Capacity, control exception, and 60-second expiry.
 *    - Control cap: Independent 120/min reserve that does not bypass overload.
 * ============================================================================
 */

import { Admission } from '../../src/operations/admission.js';
it('uses a bounded shared-identity window including inference-starting stream GET and expiry', () => {
  const a=new Admission(2); a.take('generation',0); a.take('generation',1);
  expect(() => a.take('generation',2)).toThrow(expect.objectContaining({ code:'RATE_LIMITED' }));
  expect(() => a.take('control',2)).not.toThrow();
  expect(() => a.take('generation',60000)).not.toThrow();
});
it('caps control requests independently instead of bypassing all overload limits', () => {
  const a=new Admission(20); for (let i=0;i<120;i++) a.take('control',i);
  expect(() => a.take('control',120)).toThrow(expect.objectContaining({ code:'RATE_LIMITED' }));
});
