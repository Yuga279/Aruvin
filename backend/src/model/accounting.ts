/**
 * ============================================================================
 * FILE: accounting.ts
 * LOCATION: backend/src/model/accounting.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Normalize absolute usage snapshots and reconcile generation-level billing.
 *
 * ROLE IN PROJECT:
 *    Writes AccountingRecord snapshots through MetadataRepository, looks up
 *    native tokens and total_cost without repeating inference, and keeps
 *    missing counts as null rather than fabricating zeros.
 *
 * KEY COMPONENTS:
 *    - mergeUsage/fromGeneration/status: Absolute field merge and knownness.
 *    - AccountingService: Scoped save, saveRaw, snapshot, and bounded GET reconciliation.
 * ============================================================================
 */

import type { AccountingRecord } from '../contracts/metadata.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import type { MetadataRepository } from '../contracts/repositories.js';
import { AppError } from '../platform/errors/app-error.js';
import { type ModelConfig, OPENROUTER_BASE, TRANSPORT_LIMITS } from './policy.js';
import { object, providerFault, retryDelay } from './faults.js';
import { bounded, readJson, sleep } from './deadlines.js';
import { decimalFromNumber, unavailableMoney, type MoneyEvidence } from '../contracts/usage-evidence.js';

export function number(value:unknown,integer=false):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0&&(!integer||Number.isSafeInteger(value))?value:null;}
export function identifier(value:unknown):string|null{return typeof value==='string'&&value.length>0&&value.length<=200?value:null;}
export function status(r:AccountingRecord):AccountingRecord{return {...r,accountingStatus:r.promptTokens!==null&&r.completionTokens!==null&&r.cost!==null?'known':r.generationId?'pending':'unknown',
  ...(r.money?.reportedAmount===null?{money:{...r.money,costStatus:r.generationId?'pending':'unknown'}}:{})};}
export function mergeUsage(r:AccountingRecord,raw:unknown):AccountingRecord{
  const u=object(raw), prompt=object(u.prompt_tokens_details), completion=object(u.completion_tokens_details);
  const details:Partial<AccountingRecord>={};
  for(const [field,value] of [['cachedPromptTokens',prompt.cached_tokens],['cacheWriteTokens',prompt.cache_write_tokens],
    ['reasoningOutputTokens',completion.reasoning_tokens]] as const){
    const count=number(value,true); if(count!==null)details[field]=count;
  }
  return status({...r,...details,promptTokens:number(u.prompt_tokens,true)??r.promptTokens,completionTokens:number(u.completion_tokens,true)??r.completionTokens,...costEvidence(r,number(u.cost),'provider-response')});
}
function costEvidence(r:AccountingRecord,cost:number|null,source:MoneyEvidence['source']):Pick<AccountingRecord,'cost'|'money'> {
  if(cost===null)return {cost:r.cost,...(r.money?{money:r.money}:{})};
  const amount=decimalFromNumber(cost);
  if(r.money?.reportedAmount!==null&&r.money?.reportedAmount!==undefined&&r.money.reportedAmount!==amount)
    throw new AppError('PROVIDER_ERROR','Provider accounting evidence disagreed.',false);
  if(r.cost!==null&&r.cost!==cost)throw new AppError('PROVIDER_ERROR','Provider accounting evidence disagreed.',false);
  return {cost,money:r.money?.reportedAmount===amount?r.money:{...unavailableMoney(),reportedAmount:amount,costStatus:'known',source,observedAt:new Date().toISOString()}};
}
export function fromGeneration(r:AccountingRecord,raw:unknown):AccountingRecord{
  const d=object(object(raw).data);
  if(identifier(d.id)!==r.generationId)throw new AppError('PROVIDER_ERROR','Accounting identity did not match.',false);
  const cached=number(d.native_tokens_cached,true),reasoning=number(d.native_tokens_reasoning,true);
  return status({...r,...(cached!==null?{cachedPromptTokens:cached}:{}),...(reasoning!==null?{reasoningOutputTokens:reasoning}:{}),reportedModel:identifier(d.model)??r.reportedModel,reportedProvider:identifier(d.provider_name)??r.reportedProvider,promptTokens:number(d.native_tokens_prompt,true)??r.promptTokens,completionTokens:number(d.native_tokens_completion,true)??r.completionTokens,...costEvidence(r,number(d.total_cost),'provider-generation')});
}
export class AccountingService {
  private latest:AccountingRecord|null=null;
  constructor(private config:ModelConfig,private repository:Pick<MetadataRepository,'putAccounting'>,private fetcher:typeof fetch=fetch,private random:()=>number=Math.random){}
  snapshot(userId:string,sessionId:string,attemptId:string):AccountingRecord|null{
    const r=this.latest;return r&&r.userId===userId&&r.sessionId===sessionId&&r.attemptId===attemptId?{...r}:null;
  }
  async saveRaw(record:AccountingRecord,signal?:AbortSignal):Promise<void>{
    const parsed=accountingRecordSchema.parse(record);
    if(parsed.userId!==this.config.identity.userId||parsed.requestedModel!==this.config.openRouter.modelId)throw new AppError('CONFIGURATION_ERROR','The accounting scope is invalid.',false);
    if(signal?.aborted)throw new AppError('CANCELLED','Generation was cancelled.',false);
    await this.repository.putAccounting(parsed);
    this.latest={...parsed};
  }
  async save(record:AccountingRecord,signal:AbortSignal):Promise<void>{
    const parsed=accountingRecordSchema.parse(record);
    if(parsed.userId!==this.config.identity.userId||parsed.requestedModel!==this.config.openRouter.modelId)throw new AppError('CONFIGURATION_ERROR','The accounting scope is invalid.',false);
    if(signal.aborted)throw new AppError('CANCELLED','Generation was cancelled.',false);
    try{await bounded(this.saveRaw(record,signal),this.config.budgets.persistenceTimeoutMs,signal,'PERSISTENCE_ERROR');}
    catch(error){if(error instanceof AppError)throw error;throw new AppError('PERSISTENCE_ERROR','The chat accounting could not be saved.',false);}
  }
  async reconcile(record:AccountingRecord,outer:AbortSignal):Promise<AccountingRecord>{
    let result=accountingRecordSchema.parse(record);
    if(result.userId!==this.config.identity.userId||result.requestedModel!==this.config.openRouter.modelId)throw new AppError('CONFIGURATION_ERROR','The accounting scope is invalid.',false);
    const latest=this.snapshot(result.userId,result.sessionId,result.attemptId);
    if(latest?.generationId===result.generationId&&latest.requestedModel===result.requestedModel
      &&latest.startedAt===result.startedAt&&latest.turnId===result.turnId){
      const evidence:Partial<AccountingRecord>={};
      for(const field of ['cost','promptTokens','completionTokens','cachedPromptTokens','cacheWriteTokens',
        'reasoningOutputTokens','reportedModel','reportedProvider','endedAt','timing'] as const)
        if(result[field]==null&&latest[field]!==undefined)Object.assign(evidence,{[field]:latest[field]});
      if(latest.money&&(!result.money||result.money.reportedAmount===null)
        &&(result.cost===null||result.cost===latest.cost))evidence.money=latest.money;
      result=status({...result,...evidence});
    }
    if(!result.generationId||result.accountingStatus==='known'){await this.save(result,outer);return result;}
    const controller=new AbortController();const abort=()=>controller.abort();
    if(outer.aborted)abort();else outer.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,this.config.budgets.connectTimeoutMs);
    try{
      for(let dispatch=1;dispatch<=this.config.budgets.retryMaxAttempts;dispatch++){
        if(controller.signal.aborted)break;
        let http:Response;
        try{http=await this.fetcher(`${OPENROUTER_BASE}/generation?id=${encodeURIComponent(result.generationId)}`,{headers:{Authorization:`Bearer ${this.config.openRouter.apiKey}`},signal:controller.signal});}
        catch{break;}
        if(http.ok){
          try{result=fromGeneration(result,await readJson(http,TRANSPORT_LIMITS.jsonBytes));}catch{break;}
          break;
        }
        await http.body?.cancel().catch(()=>undefined);
        if(![404,429,503].includes(http.status)){
          // No credential/credit retry; account degradation is separate from turn outcome.
          if(http.status===401||http.status===403||http.status===402)throw providerFault(http.status);
          break;
        }
        if(dispatch===this.config.budgets.retryMaxAttempts)break;
        const delay=retryDelay(this.config.budgets,dispatch,this.random(),http.headers.get('retry-after'));
        if(delay===null)break;
        try{await sleep(delay,controller.signal);}catch{break;}
      }
      if(result.accountingStatus!=='known')result={...result,accountingStatus:'unknown'};
      await this.save(result,outer);return result;
    }finally{clearTimeout(timer);outer.removeEventListener('abort',abort);}
  }
}
