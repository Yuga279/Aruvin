/**
 * ============================================================================
 * FILE: policy.ts
 * LOCATION: backend/src/model/policy.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bind finite model policy and serialize the OpenRouter chat request body.
 *
 * ROLE IN PROJECT:
 *    Defends identity, privacy, compression, and budget limits before any
 *    provider dispatch, then uses ChatOpenRouter.invocationParams so the
 *    outgoing JSON matches the pinned integration rather than a hand-built
 *    duplicate request.
 *
 * KEY COMPONENTS:
 *    - ModelLimits / TRANSPORT_LIMITS: Catalogue and stream size bounds.
 *    - assertRequest: Rejects mismatches and overflow without dropping history.
 *    - buildBody: Serializes user, model, caps, plugins, and privacy options.
 *    - isAnthropicModel: Identifies configured Anthropic models for prompt caching.
 * ============================================================================
 */

import { ChatOpenRouter } from '@langchain/openrouter';
import type { AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import type { ModelInvokeRequest } from '../contracts/runtime.js';
import type { VerifiedModelLimits } from '../contracts/config-runtime.js';

export type ModelLimits = VerifiedModelLimits;
export type ModelConfig = Pick<AurvinConfig, 'identity' | 'budgets' | 'openRouter'>;
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const TRANSPORT_LIMITS = { frameBytes:65536, streamBytes:1048576, frames:10000, jsonBytes:65536, catalogueBytes:4194304, outputChars:32000 } as const;

export function assertRequest(c:ModelConfig,l:ModelLimits,r:ModelInvokeRequest):void {
  const configError = () => { throw new AppError('CONFIGURATION_ERROR','The model configuration is unavailable.',false); };
  if (!c.openRouter.apiKey || !c.openRouter.modelId || c.openRouter.modelId.length>200 || !c.openRouter.disableTransforms || l.modelId!==c.openRouter.modelId || !Number.isSafeInteger(l.contextTokens) || !Number.isSafeInteger(l.outputTokens) || l.contextTokens<c.budgets.maxContextTokens || l.outputTokens<c.budgets.maxOutputTokens || !l.supportsMaxTokens) configError();
  if (r.modelId!==c.openRouter.modelId || r.user!==c.identity.userId || !r.user || r.user.length>128 || r.dataCollection!==c.openRouter.dataCollection || r.transforms.length!==0) configError();
  if (!Number.isSafeInteger(r.maxOutputTokens) || r.maxOutputTokens<=0 || r.maxOutputTokens>c.budgets.maxOutputTokens) throw new AppError('INVALID_REQUEST','The output limit is invalid.',false);
  if (!r.messages.length || r.messages.length>c.budgets.maxMessagesInContext) throw new AppError('CONTEXT_BUDGET_EXCEEDED','This chat is too long. Start a new chat.',false);
  let estimated=64;
  for (const m of r.messages) {
    if (!['system','user','assistant'].includes(m.role) || typeof m.content!=='string') throw new AppError('INVALID_REQUEST','The chat input is invalid.',false);
    const bytes=Buffer.byteLength(m.content,'utf8');
    if (bytes>c.budgets.maxMessageBytes) throw new AppError('INPUT_TOO_LARGE','A chat message is too large.',false);
    estimated+=bytes+32;
  }
  const last=[...r.messages].reverse().find(m=>m.role==='user');
  if (!last || last.content.length>c.budgets.maxInputChars || Buffer.byteLength(last.content,'utf8')>c.budgets.maxInputTokens) throw new AppError('INPUT_TOO_LARGE','The chat input is too large.',false);
  if (estimated+r.maxOutputTokens+c.budgets.modelMarginTokens>c.budgets.maxContextTokens) throw new AppError('CONTEXT_BUDGET_EXCEEDED','This chat is too long. Start a new chat.',false);
}

export function isAnthropicModel(modelId: string): boolean {
  return typeof modelId === 'string' && modelId.trim().toLowerCase().startsWith('anthropic/');
}

export function providerParameters(c:ModelConfig,r:{user:string;maxOutputTokens:number}):Record<string,unknown> {
  const plugins=['context-compression','web','file-parser','response-healing'].map(id=>({id,enabled:false}));
  const model=new ChatOpenRouter({apiKey:c.openRouter.apiKey,model:c.openRouter.modelId,user:r.user,maxTokens:r.maxOutputTokens,maxRetries:0,streamUsage:true,transforms:[],provider:{data_collection:c.openRouter.dataCollection,require_parameters:true},plugins,siteName:'Aurvin',siteUrl:''});
  // Do not inherit global session grouping/tracing settings; the attempt adapter binds conversation routing.
  model.sessionId=undefined;
  model.trace=undefined;
  const params: Record<string, unknown> = model.invocationParams({});
  if (isAnthropicModel(c.openRouter.modelId)) {
    params.cache_control = { type: 'ephemeral' };
  }
  return params;
}

export function buildBody(c:ModelConfig,l:ModelLimits,r:ModelInvokeRequest):Record<string,unknown> {
  assertRequest(c,l,r);
  return {...providerParameters(c,r),messages:r.messages.map(m=>({role:m.role,content:m.content})),stream:true,stream_options:{include_usage:true}};
}
