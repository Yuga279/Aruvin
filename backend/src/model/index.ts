/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/model/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the P4 factory boundary for attempt adapters and catalogue limits.
 *
 * ROLE IN PROJECT:
 *    Lets P5/P8/P9/P10 consume an unchanged ModelAdapter plus a local
 *    attempt-bound accounting helper without editing Nest entry points here.
 *
 * KEY COMPONENTS:
 *    - createModelServices: Per-attempt adapter factory and reconcile service.
 *    - loadModelLimits / AccountingService re-exports for readiness and recovery.
 *    - calendarEvidenceFor: Frozen Calendar capability/price evidence by model id.
 *    - createObservationWriter / ObservationWriter: Supervised observation writer.
 * ============================================================================
 */

import type { ModelAdapter } from '../contracts/runtime.js';
import type { AccountingRecord } from '../contracts/metadata.js';
import type { MetadataRepository } from '../contracts/repositories.js';
import type { ModelConfig, ModelLimits } from './policy.js';
import { AccountingService } from './accounting.js';
import { OpenRouterAttemptAdapter } from './openrouter-adapter.js';
import type { DiagnosticSink } from '../chat-runtime/ports.js';
export { loadModelLimits, prepareTextConfiguration } from './catalogue.js';
export type { CalendarCatalogueEvidence } from './catalogue.js';
export { calendarEvidenceFor, CALENDAR_PRICE_TABLE, CALENDAR_EVIDENCE_VERSION,
  CALENDAR_NATIVE_STRICT, CALENDAR_PARALLEL_TOOL_CALLS_PARAMETER,
  CALENDAR_DEFAULT_PROVIDER_ROUTE } from './calendar-evidence.js';
export type { ModelConfig, ModelLimits } from './policy.js';
export { AccountingService } from './accounting.js';
export { createCalendarModelPort } from './calendar-adapter.js';
export { rebuildCalendarMessages, repairInstruction } from './calendar-repair.js';
export { estimateCalendarInput } from './calendar-policy.js';
export { createObservationWriter, type ObservationWriter, type ObservationWriterOptions } from './observation-writer.js';
export type AttemptModelAdapter=ModelAdapter & {readonly accounting:AccountingService};
export function createModelServices(config:ModelConfig,limits:ModelLimits,metadata:Pick<MetadataRepository,'putAccounting'>,fetcher:typeof fetch=fetch,random:()=>number=Math.random,diagnostic?:DiagnosticSink,supervision?:{track:<T>(promise:Promise<T>)=>Promise<T>;fail:(error:unknown)=>void;identityBarrier?:(action:()=>Promise<void>)=>Promise<void>;nonBlockingStream?:boolean}){
  const accounting=new AccountingService(config,metadata,fetcher,random);
  return {accounting,createAttemptAdapter:(seed:AccountingRecord,onGenerationId:(id:string)=>Promise<void>):AttemptModelAdapter=>new OpenRouterAttemptAdapter(config,limits,seed,new AccountingService(config,metadata,fetcher,random),onGenerationId,fetcher,random,diagnostic,supervision)};
}
