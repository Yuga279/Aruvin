/**
 * ============================================================================
 * FILE: helpers.ts
 * LOCATION: backend/test/model/helpers.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Share fixture requests, accounting seeds, and byte-split stream helpers.
 *
 * ROLE IN PROJECT:
 *    Keeps P4 model tests deterministic by injecting fake fetch, metadata
 *    sinks, and arbitrary UTF-8 packet segmentation without live services.
 *
 * KEY COMPONENTS:
 *    - config/limits/request/seed: Bound attempt and invoke fixtures.
 *    - bytes/response/collect/sink: Stream splitting and accounting fakes.
 * ============================================================================
 */

import { loadConfig } from '../../src/platform/config/load-config.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';
import type { AccountingRecord } from '../../src/contracts/metadata.js';
import type { ModelLimits } from '../../src/model/policy.js';

export const config=()=>loadConfig({OPENROUTER_API_KEY:'fixture-key',OPENROUTER_MODEL:'fixture/model'});
export const limits:ModelLimits={modelId:'fixture/model',contextTokens:32768,outputTokens:4096,supportsMaxTokens:true,source:'fixture'};
export const request=(signal=new AbortController().signal):ModelInvokeRequest=>({modelId:'fixture/model',user:'aurvin-dev-user',messages:[{role:'system',content:'Rules'},{role:'user',content:'Hello'}],maxOutputTokens:2048,abortSignal:signal,transforms:[],dataCollection:'deny'});
export const seed=():AccountingRecord=>({schemaVersion:1,kind:'accounting',userId:'aurvin-dev-user',sessionId:'sess_fixture',turnId:'turn_fixture',attemptId:'att_fixture',generationId:null,requestedModel:'fixture/model',reportedModel:null,reportedProvider:null,promptTokens:null,completionTokens:null,cost:null,accountingStatus:'unknown',outcome:'generating',startedAt:'2026-10-06T00:00:00.000Z',endedAt:null});
export function bytes(text:string,width=1):ReadableStream<Uint8Array> {
  const data=new TextEncoder().encode(text);
  return new ReadableStream({start(c){for(let i=0;i<data.length;i+=width)c.enqueue(data.slice(i,i+width));c.close();}});
}
export const response=(text:string,width=1)=>new Response(bytes(text,width),{status:200,headers:{'content-type':'text/event-stream'}});
export async function collect<T>(items:AsyncIterable<T>):Promise<T[]> { const out:T[]=[]; for await(const item of items)out.push(item); return out; }
export const sink=()=>({putAccounting:vi.fn<(r:AccountingRecord)=>Promise<void>>().mockResolvedValue(undefined)});
