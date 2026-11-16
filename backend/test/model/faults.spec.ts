/**
 * ============================================================================
 * FILE: faults.spec.ts
 * LOCATION: backend/test/model/faults.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify sanitized provider error classification and rejection retry policy.
 *
 * ROLE IN PROJECT:
 *    Ensures HTTP and structured provider faults map to AppError codes without
 *    leaking payloads, and that automatic retries stay limited to definitive
 *    pre-stream 429/503 rejections.
 *
 * KEY COMPONENTS:
 *    - Status/code mapping tests: Auth, credits, context, and provider errors.
 *    - Retry/jitter tests: Definitive rejection predicate and Retry-After cap.
 * ============================================================================
 */

import { providerFault, mayRetryRejection, retryDelay } from '../../src/model/faults.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';

it.each([[400,'INVALID_REQUEST'],[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[402,'PROVIDER_CREDITS'],[413,'CONTEXT_BUDGET_EXCEEDED'],[429,'RATE_LIMITED'],[500,'PROVIDER_ERROR'],[502,'PROVIDER_ERROR'],[503,'PROVIDER_ERROR']])('maps %i without leaking payload', (status,code)=>{
  const error=providerFault(status);
  expect(error.code).toBe(code);
  expect(error.message).not.toMatch(/private|fixture-key|stack|metadata|Mongo/i);
});
it('recognizes structured context errors and does not classify by private prose',()=>{
  expect(providerFault(400,'context_length_exceeded').code).toBe('CONTEXT_BUDGET_EXCEEDED');
  expect(providerFault(400,'invalid_api_key').code).toBe('PROVIDER_AUTH');
  expect(providerFault(200,'server_error').code).toBe('PROVIDER_ERROR');
});
it('retries only definitive rejection before generation or visible output',()=>{
  expect(mayRetryRejection(429,{error:{code:429}},false,false)).toBe(true);
  expect(mayRetryRejection(503,{error:{code:503}},false,false)).toBe(true);
  for(const status of [200,400,401,402,403,413,500,502,504])expect(mayRetryRejection(status,{error:{code:status}},false,false)).toBe(false);
  expect(mayRetryRejection(503,{error:{code:503}},true,false)).toBe(false);
  expect(mayRetryRejection(429,{error:{code:429}},false,true)).toBe(false);
  expect(mayRetryRejection(503,{},false,false)).toBe(false);
});
it('uses capped full jitter and refuses excessive Retry-After',()=>{
  expect(retryDelay(DEFAULT_BUDGETS,1,0.5,null)).toBe(250);
  expect(retryDelay(DEFAULT_BUDGETS,2,1,null)).toBe(1000);
  expect(retryDelay(DEFAULT_BUDGETS,1,0.5,'2')).toBe(2000);
  expect(retryDelay(DEFAULT_BUDGETS,1,0.5,'3600')).toBeNull();
});
it('maps auth codes even inside HTTP-200 errors',()=>{
  expect(providerFault(200,401).code).toBe('PROVIDER_AUTH');expect(providerFault(200,403).code).toBe('PROVIDER_AUTH');
});
it('caps exponential delay and parses HTTP-date Retry-After deterministically',()=>{
  expect(retryDelay(DEFAULT_BUDGETS,99,1,null)).toBe(5000);
  expect(retryDelay(DEFAULT_BUDGETS,1,0,'Tue, 06 Oct 2026 00:00:02 GMT',Date.parse('2026-10-06T00:00:00Z'))).toBe(2000);
});

