/**
 * ============================================================================
 * FILE: faults.ts
 * LOCATION: backend/src/model/faults.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Classify provider HTTP/stream faults and bound definitive rejection retries.
 *
 * ROLE IN PROJECT:
 *    Maps status and structured error codes to sanitized AppError values, and
 *    restricts automatic POST retries to pre-stream 429/503 rejections with a
 *    valid envelope and no generation identity or visible text.
 *
 * KEY COMPONENTS:
 *    - providerFault: Safe error taxonomy without provider payload leakage.
 *    - mayRetryRejection / retryDelay: Finite jitter and Retry-After policy.
 * ============================================================================
 */

import type { BudgetConfig } from '../contracts/budgets.js';
import { AppError } from '../platform/errors/app-error.js';
export function object(value:unknown):Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export function providerFault(status:number,code?:unknown):AppError {
  if(typeof code==='string'&&/^\d{3}$/.test(code))code=Number(code);
  if(status===401||status===403||code===401||code===403||code==='invalid_api_key')return new AppError('PROVIDER_AUTH','The model service credentials are unavailable.',false);
  if(status===402||code===402||code==='insufficient_credits')return new AppError('PROVIDER_CREDITS','The model service has insufficient credits.',false);
  if(status===413||code===413||code==='context_length_exceeded')return new AppError('CONTEXT_BUDGET_EXCEEDED','This chat is too long. Start a new chat.',false);
  if(status===400||status===422||code===400)return new AppError('INVALID_REQUEST','The model service rejected the input.',false);
  if(status===429||code===429||code==='rate_limit_exceeded')return new AppError('RATE_LIMITED','The model service is busy. Try again later.',true);
  return new AppError('PROVIDER_ERROR','The model service could not answer. Try again.',true);
}
export function mayRetryRejection(status:number,body:unknown,hasId:boolean,hasText:boolean):boolean {
  const top=object(body),error=object(top.error);
  return (status===429||status===503)&&!hasId&&!hasText&&!top.id&&error.code===status;
}
export function retryDelay(b:BudgetConfig,number:number,random:number,header:string|null,now=Date.now()):number|null {
  const jitter=Math.floor(Math.max(0,Math.min(1,random))*Math.min(b.retryMaxDelayMs,b.retryBaseDelayMs*2**(number-1)));
  if(!header)return jitter;
  const numeric=Number(header);
  const requested=/^\d+(\.\d+)?$/.test(header)?numeric*1000:Date.parse(header)-now;
  if(!Number.isFinite(requested)||requested<0)return jitter;
  if(requested>b.retryMaxDelayMs)return null;
  return Math.max(jitter,Math.ceil(requested));
}
