/**
 * ============================================================================
 * FILE: catalogue.ts
 * LOCATION: backend/src/model/catalogue.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Load non-inference capability limits for the configured OpenRouter model.
 *
 * ROLE IN PROJECT:
 *    Lets P8/P9 verify context, native completion cap, and max_tokens support
 *    at readiness time without a paid chat POST or process restart loop.
 *
 * KEY COMPONENTS:
 *    - loadModelLimits: GET /models, select the configured model, fail closed.
 *    - derivedCalendar: Admit tools from live catalogue prices when unpinned.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';
import { OPENROUTER_BASE, TRANSPORT_LIMITS, type ModelConfig, type ModelLimits } from './policy.js';
import { object } from './faults.js';
import { number } from './accounting.js';
import { readJson } from './deadlines.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import { assertFixedContextFits } from '../context/context-budget.js';
import { tokenPricingSchema, type CalendarTokenPricing } from '../contracts/calendar-accounting.js';
import { canonicalDecimal } from '../contracts/usage-evidence.js';

export type CalendarCatalogueEvidence = {
  pricing: CalendarTokenPricing;
  nativeStrict: boolean;
  parallelToolCallsParameter: boolean;
};

function decimalPrice(value: unknown): string | null {
  try {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      return canonicalDecimal(String(value));
    }
    if (typeof value !== 'string' || value === '') return null;
    return canonicalDecimal(value);
  } catch {
    return null;
  }
}

function listedCalendarPrices(entry: Record<string, unknown>): {
  prompt: string; completion: string; requestUsd: string;
} | undefined {
  const listed = object(entry.pricing);
  const prompt = decimalPrice(listed.prompt);
  const completion = decimalPrice(listed.completion);
  if (prompt === null || completion === null) return undefined;
  let requestUsd = '0';
  if (listed.request !== undefined) {
    const request = decimalPrice(listed.request);
    if (request === null) return undefined;
    requestUsd = request;
  }
  return { prompt, completion, requestUsd };
}

function verifiedCalendar(entry: Record<string, unknown>, evidence: CalendarCatalogueEvidence, modelId: string): ModelLimits['calendar'] {
  try {
    const pricing = tokenPricingSchema.parse(evidence.pricing);
    if (pricing.modelId !== modelId) return undefined;
    const supported = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
    if (!supported.includes('tools')) return undefined;
    if (evidence.parallelToolCallsParameter && !supported.includes('parallel_tool_calls')) return undefined;
    if (evidence.nativeStrict && !supported.includes('structured_outputs')) return undefined;
    const listed = listedCalendarPrices(entry);
    if (!listed) return undefined;
    if (listed.prompt !== pricing.promptUsdPerToken || listed.completion !== pricing.completionUsdPerToken) return undefined;
    if (object(entry.pricing).request !== undefined && listed.requestUsd !== pricing.requestUsd) return undefined;
    return { tools: true, nativeStrict: evidence.nativeStrict,
      parallelToolCallsParameter: evidence.parallelToolCallsParameter, pricing };
  } catch {
    return undefined;
  }
}

function derivedCalendar(entry: Record<string, unknown>, modelId: string): ModelLimits['calendar'] {
  try {
    const supported = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
    if (!supported.includes('tools')) return undefined;
    const listed = listedCalendarPrices(entry);
    if (!listed) return undefined;
    const slash = modelId.indexOf('/');
    const vendor = slash > 0 ? modelId.slice(0, slash) : 'openrouter';
    const pricing = tokenPricingSchema.parse({
      version: 'openrouter-catalogue-live',
      source: 'OpenRouter GET /api/v1/models catalogue',
      observedAt: new Date().toISOString(),
      modelId,
      providerRoute: `openrouter-default/${vendor}`.slice(0, 200),
      promptUsdPerToken: listed.prompt,
      completionUsdPerToken: listed.completion,
      requestUsd: listed.requestUsd,
    });
    return { tools: true, nativeStrict: false, parallelToolCallsParameter: false, pricing };
  } catch {
    return undefined;
  }
}

export async function prepareTextConfiguration(c: ModelConfig, assets: FixedAssets,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ModelLimits | null> {
  assertFixedContextFits(assets, c.budgets);
  if (!c.openRouter.apiKey || !c.openRouter.modelId) return null;
  return loadModelLimits(c, signal, fetcher);
}

export async function loadModelLimits(c:ModelConfig,outer:AbortSignal,fetcher:typeof fetch=fetch,calendarEvidence?:CalendarCatalogueEvidence):Promise<ModelLimits>{
  if(!c.openRouter.modelId||!c.openRouter.apiKey||!c.openRouter.disableTransforms)throw new AppError('CONFIGURATION_ERROR','The model configuration is unavailable.',false);
  const controller=new AbortController();const abort=()=>controller.abort();
  if(outer.aborted)abort();else outer.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,c.budgets.connectTimeoutMs);
  try{
    if(controller.signal.aborted)throw new Error('catalogue aborted');
    const http=await fetcher(`${OPENROUTER_BASE}/models`,{headers:{Authorization:`Bearer ${c.openRouter.apiKey}`},signal:controller.signal,redirect:'error'});
    if(!http.ok){await http.body?.cancel().catch(()=>undefined);throw new Error('catalogue unavailable');}
    const raw=object(await readJson(http,TRANSPORT_LIMITS.catalogueBytes));
    const entries=Array.isArray(raw.data)?raw.data:[];
    const entry=object(entries.find(v=>object(v).id===c.openRouter.modelId));
    const context=number(entry.context_length,true),output=number(object(entry.top_provider).max_completion_tokens,true);
    const supports=Array.isArray(entry.supported_parameters)&&entry.supported_parameters.includes('max_tokens');
    if(context===null||output===null||context<=0||output<=0||!Number.isSafeInteger(context)||!Number.isSafeInteger(output)||context<c.budgets.maxContextTokens||output<c.budgets.maxOutputTokens||!supports)throw new Error('model caps unavailable');
    const text:ModelLimits={modelId:c.openRouter.modelId,contextTokens:context,outputTokens:output,supportsMaxTokens:true,source:'catalogue'};
    const calendar=calendarEvidence
      ?verifiedCalendar(entry,calendarEvidence,c.openRouter.modelId)
      :derivedCalendar(entry,c.openRouter.modelId);
    return calendar?{...text,calendar}:text;
  }catch{throw new AppError('CONFIGURATION_ERROR','The configured model limits could not be verified.',false);}
  finally{clearTimeout(timer);outer.removeEventListener('abort',abort);}
}
