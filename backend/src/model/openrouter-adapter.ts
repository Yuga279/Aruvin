/**
 * ============================================================================
 * FILE: openrouter-adapter.ts
 * LOCATION: backend/src/model/openrouter-adapter.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Stream one durable attempt through a bounded raw OpenRouter SSE transport.
 *
 * ROLE IN PROJECT:
 *    Implements ModelAdapter for P5 without emitting application completion,
 *    preserves comments/usage/generation identity discarded by the high-level
 *    ChatOpenRouter stream, and records absolute accounting snapshots for the
 *    bound attempt only.
 *
 * KEY COMPONENTS:
 *    - OpenRouterAttemptAdapter: One-shot dispatch, finite 429/503 retries.
 *    - Stream state machine: Comment, ID hook, delta, usage, length, and end.
 *    - Supervised bounded observation writer: Overlaps non-authoritative timing.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import type { ModelAdapter, ModelInvokeRequest, ModelChunk } from '../contracts/runtime.js';
import type { AccountingRecord } from '../contracts/metadata.js';
import { AppError } from '../platform/errors/app-error.js';
import { OPENROUTER_BASE, TRANSPORT_LIMITS as L, buildBody, type ModelConfig, type ModelLimits } from './policy.js';
import { AccountingService, identifier, mergeUsage, status } from './accounting.js';
import { object, providerFault, mayRetryRejection, retryDelay } from './faults.js';
import { RunDeadlines, bounded, readJson, sleep } from './deadlines.js';
import { parseSse } from './sse.js';
import { emptyTiming, unavailableMoney, type TimingEvidence } from '../contracts/usage-evidence.js';
import { diagnose, type DiagnosticSink } from '../chat-runtime/ports.js';
import { StreamTiming } from '../benchmark/stream-timing.js';
import { createObservationWriter, type ObservationWriter } from './observation-writer.js';

function mergeAccounting(prev: AccountingRecord, next: AccountingRecord): AccountingRecord {
  if (prev.generationId && next.generationId && prev.generationId !== next.generationId) {
    throw new AppError('PROVIDER_ERROR', 'The response identity changed.', false);
  }
  if (prev.promptTokens !== null && next.promptTokens !== null && next.promptTokens < prev.promptTokens) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  if (prev.completionTokens !== null && next.completionTokens !== null && next.completionTokens < prev.completionTokens) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  if (prev.cost !== null && next.cost !== null && next.cost !== prev.cost) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  if (prev.money?.reportedAmount && next.money?.reportedAmount && prev.money.reportedAmount !== next.money.reportedAmount) {
    throw new AppError('PROVIDER_ERROR', 'Provider accounting evidence disagreed.', false);
  }
  const baseTiming = prev.timing ?? emptyTiming();
  const nextTiming: Partial<TimingEvidence> = next.timing ?? {};
  const timing: TimingEvidence = {
    dispatchedAt: nextTiming.dispatchedAt ?? baseTiming.dispatchedAt,
    firstOutputAt: nextTiming.firstOutputAt ?? baseTiming.firstOutputAt,
    providerEndedAt: nextTiming.providerEndedAt ?? baseTiming.providerEndedAt,
    durableCompletedAt: nextTiming.durableCompletedAt ?? baseTiming.durableCompletedAt,
    providerDurationMs: nextTiming.providerDurationMs ?? baseTiming.providerDurationMs,
    firstOutputLatencyMs: nextTiming.firstOutputLatencyMs ?? baseTiming.firstOutputLatencyMs,
    dispatchCount: nextTiming.dispatchCount ?? baseTiming.dispatchCount,
  };
  return status({
    ...prev,
    ...next,
    timing,
  });
}

export class OpenRouterAttemptAdapter implements ModelAdapter {
  private used=false;
  constructor(private config:ModelConfig,private limits:ModelLimits,private record:AccountingRecord,readonly accounting:AccountingService,private onGenerationId:(id:string)=>Promise<void>,private fetcher:typeof fetch=fetch,private random:()=>number=Math.random,private diagnostic?:DiagnosticSink,private supervision?:{track:<T>(promise:Promise<T>)=>Promise<T>;fail:(error:unknown)=>void;identityBarrier?:(action:()=>Promise<void>)=>Promise<void>;nonBlockingStream?:boolean}){}
  async *stream(request:ModelInvokeRequest):AsyncGenerator<ModelChunk>{
    if(this.used)throw new AppError('INVALID_REQUEST','This attempt has already run.',false);
    this.used=true;
    const body=buildBody(this.config,this.limits,request);
    if(this.record.userId!==request.user||this.record.requestedModel!==request.modelId||this.record.generationId!==null||this.record.outcome!=='generating')throw new AppError('CONFIGURATION_ERROR','The model attempt is invalid.',false);
    // Bind routing to the durable server identity, not input, turn/attempt IDs, or global settings.
    body.session_id=`aurvin-${createHash('sha256').update(JSON.stringify([this.record.userId,this.record.sessionId])).digest('hex')}`;
    const d=new RunDeadlines(this.config.budgets,request.abortSignal);
    this.record={...this.record,timing:emptyTiming(),money:this.record.money??unavailableMoney()};
    let dispatchClock:number|null=null;
    let streamTiming: StreamTiming | undefined;
    let started=false,providerEnd=false,visible=false,finish:string|null=null,totalChars=0,totalBytes=0,lastUsage='',http:Response|undefined;
    let pendingIdentity: Promise<void> | undefined;
    let identityFailure: unknown;
    let accountingSignal = d.signal;

    let writer: ObservationWriter<AccountingRecord> | undefined;
    if (this.supervision) {
      writer = createObservationWriter<AccountingRecord>({
        initial: this.record,
        merge: (prev, next) => mergeAccounting(prev, next),
        persist: async snapshot => {
          await this.accounting.saveRaw(snapshot, accountingSignal);
        },
        track: this.supervision.track,
        fail: err => {
          this.supervision!.fail(err);
          d.stop();
        },
      });
    }

    const save = async (): Promise<void> => {
      if (writer) {
        writer.enqueue(this.record);
        await writer.flush();
      } else {
        await this.accounting.save(this.record, d.signal);
      }
    };

    const capture=async(id:string)=>{
      if(this.record.generationId&&this.record.generationId!==id)throw new AppError('PROVIDER_ERROR','The response identity changed.',false);
      if(this.record.generationId)return false;
      this.record=status({...this.record,generationId:id});
      diagnose(this.diagnostic,{stage:'model-response',provider:'openrouter',generationId:id,origin:'provider',delivery:'response-received',attemptId:this.record.attemptId});
      const persistIdentity = async () => {
        const identify = async () => {
          try{await bounded(this.onGenerationId(id),this.config.budgets.persistenceTimeoutMs,d.signal,'PERSISTENCE_ERROR');}
          catch(error){if(error instanceof AppError)throw error;throw new AppError('PERSISTENCE_ERROR','The chat could not be saved.',false);}
        };
        if (this.supervision?.nonBlockingStream) {
          await identify();
          await save();
        } else {
          // Independent records share the ownership phase, not a serial write dependency.
          // Settle both before cleanup so a late generating write cannot overwrite failure evidence.
          const results = await Promise.allSettled([identify(), save()]);
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        }
      };
      if (this.supervision?.nonBlockingStream) {
        const wasAborted = d.signal.aborted;
        const task = (async () => {
          if (writer) await writer.flush();
          if (this.supervision?.identityBarrier) await this.supervision.identityBarrier(persistIdentity);
          else await persistIdentity();
        })();
        pendingIdentity = this.supervision.track(task).catch(err => {
          if (!wasAborted && !d.signal.aborted) {
            identityFailure ??= err;
          } else {
            identityFailure ??= d.failure();
          }
          this.supervision!.fail(err);
          d.stop();
          throw err;
        });
        void pendingIdentity.catch(() => undefined);
        return true;
      }
      // Both durable identity writes still precede output and share one ownership fence.
      if (this.supervision?.identityBarrier) await this.supervision.identityBarrier(persistIdentity);
      else await persistIdentity();
      return true;
    };
    try{
      // The first dispatch snapshot also initializes accounting; its acknowledged
      // save below must succeed before any paid request can leave the process.
      d.check();
      for(let dispatch=1;dispatch<=this.config.budgets.retryMaxAttempts;dispatch++){
        d.check();writer?.check();d.armConnect();started=true;
        dispatchClock??=performance.now();
        this.record={...this.record,timing:{...this.record.timing!,
          dispatchedAt:this.record.timing!.dispatchedAt??new Date().toISOString(),dispatchCount:dispatch}};
        if (!this.supervision?.nonBlockingStream) {
          await save(); // Durable possible-billing evidence before fetch
        }
        const startedAt=performance.now();
        const dispatchId=`${this.record.attemptId}:model:${dispatch}`;
        streamTiming = new StreamTiming(this.diagnostic, { attemptId: this.record.attemptId, dispatchId });
        diagnose(this.diagnostic,{stage:'model-dispatch',state:'start',provider:'openrouter',requestKind:'model',origin:'provider',delivery:'attempted',attemptId:this.record.attemptId,dispatchId});
        try{http=await this.fetcher(`${OPENROUTER_BASE}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${this.config.openRouter.apiKey}`,'Content-Type':'application/json','X-Title':'Aurvin'},body:JSON.stringify(body),signal:d.signal});}
        catch{diagnose(this.diagnostic,{stage:'model-dispatch',state:'error',provider:'openrouter',requestKind:'model',origin:'provider',delivery:'attempted',reason:'provider-error',code:'INTERRUPTED',attemptId:this.record.attemptId,dispatchId,durationMs:performance.now()-startedAt});d.check();throw new AppError('INTERRUPTED','The response could not be confirmed. Retry to continue.',false);}
        diagnose(this.diagnostic,{stage:'model-response',state:http.ok?'ok':'error',provider:'openrouter',requestKind:'model',origin:'provider',delivery:'response-received',attemptId:this.record.attemptId,dispatchId,durationMs:performance.now()-startedAt,statusClass:http.status>=500?'5xx':http.status>=400?'4xx':http.status>=300?'3xx':http.status>=200?'2xx':'other'});
        const headerId=identifier(http.headers.get('x-request-id')??http.headers.get('openrouter-request-id')??'');
        if(headerId)diagnose(this.diagnostic,{stage:'model-response',provider:'openrouter',providerRequestId:headerId,origin:'provider',delivery:'response-received',attemptId:this.record.attemptId,dispatchId});
        d.headers();
        if(http.ok)break;
        streamTiming.end(false);
        const rejected=await readJson(http,L.jsonBytes);
        const top=object(rejected);const id=identifier(top.id);
        if(id&&await capture(id)){
          if(pendingIdentity)await pendingIdentity;
          yield {type:'generation-id',generationId:id};
        }
        const fault=providerFault(http.status,object(top.error).code);
        const delay=retryDelay(this.config.budgets,dispatch,this.random(),http.headers.get('retry-after'));
        if(!mayRetryRejection(http.status,rejected,Boolean(this.record.generationId),visible)||dispatch>=this.config.budgets.retryMaxAttempts||delay===null)throw fault;
        d.resetDispatch();await sleep(delay,d.signal);
      }
      if(!http?.ok||!http.body||!http.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))throw new AppError('PROVIDER_ERROR','The model service returned an invalid stream.',false);
      for await(const frame of parseSse(http.body)){
        d.check();writer?.check();d.frame();
        if(frame.type==='comment'){yield {type:'comment',text:frame.text};continue;}
        if(frame.data==='[DONE]'){
          if(!finish||!this.record.generationId)throw new AppError('INTERRUPTED','The response could not be confirmed.',false);
          providerEnd=true;break;
        }
        let value:unknown;
        try{value=JSON.parse(frame.data) as unknown;}catch{throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);}
        const raw=object(value);if(!Object.keys(raw).length)throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);
        streamTiming?.frame(raw);
        const id=identifier(raw.id);
        if(raw.id!==undefined&&!id)throw new AppError('PROVIDER_ERROR','The response identity was invalid.',false);
        if(id&&await capture(id))yield {type:'generation-id',generationId:id};
        this.record={...this.record,reportedModel:identifier(raw.model)??this.record.reportedModel,reportedProvider:identifier(raw.provider)??this.record.reportedProvider};
        if(raw.usage!==undefined){
          this.record=mergeUsage(this.record,raw.usage);
          const usage={type:'usage' as const,promptTokens:this.record.promptTokens,completionTokens:this.record.completionTokens,cost:this.record.cost,accountingStatus:this.record.accountingStatus};
          const signature=JSON.stringify(usage);
          if(signature!==lastUsage){
            if(!this.supervision?.nonBlockingStream)await save();
            lastUsage=signature;
            yield usage;
          }
        }
        if(raw.error!==undefined){const fault=providerFault(200,object(raw.error).code);throw new AppError(fault.code,fault.message,false);}
        const choices=raw.choices===undefined&&raw.usage!==undefined?[]:raw.choices;
        if(!Array.isArray(choices))throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);
        if(choices.length>1)throw new AppError('PROVIDER_ERROR','The response stream contained multiple answers.',false);
        const choice=object(choices[0]),delta=object(choice.delta);
        if(choice.index!==undefined&&choice.index!==0)throw new AppError('PROVIDER_ERROR','The response stream was invalid.',false);
        if(delta.role!==undefined&&delta.role!=='assistant')throw new AppError('PROVIDER_ERROR','The response role was invalid.',false);
        if(delta.tool_calls!==undefined||delta.function_call!==undefined)throw new AppError('PROVIDER_ERROR','The response requested unsupported actions.',false);
        const text=delta.content;
        if(text!==undefined&&text!==null&&typeof text!=='string')throw new AppError('PROVIDER_ERROR','The response was not text.',false);
        if(typeof text==='string'&&text.length){
          if(finish)throw new AppError('PROVIDER_ERROR','The response continued after its finish marker.',false);
          if(!this.record.generationId)throw new AppError('PROVIDER_ERROR','The response identity was missing.',false);
          totalChars+=text.length;totalBytes+=Buffer.byteLength(text,'utf8');
          if(totalChars>L.outputChars||totalBytes>this.config.budgets.maxMessageBytes)throw new AppError('STORAGE_BUDGET_EXCEEDED','The response exceeded its storage limit.',false);
          if(!visible){
            this.record={...this.record,timing:{...this.record.timing!,firstOutputAt:new Date().toISOString(),
              firstOutputLatencyMs:Math.max(0,performance.now()-dispatchClock!)}};
            diagnose(this.diagnostic,{stage:'model-first-output',state:'ok',provider:'openrouter',requestKind:'model',
              durationMs:performance.now()-dispatchClock!,origin:'provider',delivery:'response-received'});
            if(writer&&!this.supervision?.nonBlockingStream){
              writer.enqueue(this.record);
            }
          }
          writer?.check();
          visible=true;d.firstText();yield {type:'delta',text};
        }
        if(choice.finish_reason!==undefined&&choice.finish_reason!==null){
          if(!['stop','length'].includes(String(choice.finish_reason)))throw new AppError('PROVIDER_ERROR','The model service did not complete its answer.',false);
          if(finish&&finish!==choice.finish_reason)throw new AppError('PROVIDER_ERROR','The response finish markers disagreed.',false);
          const first=!finish;finish=String(choice.finish_reason);d.firstText();if(first&&finish==='length')yield {type:'length'};
        }
      }
      if(!providerEnd)throw new AppError('INTERRUPTED','The response stream ended early. Retry to continue.',false);
      streamTiming?.end(true);
      d.providerFinished();d.check();writer?.check();
      if(pendingIdentity)await pendingIdentity;
      diagnose(this.diagnostic,{stage:'model-complete',state:'ok',provider:'openrouter',requestKind:'model',
        durationMs:performance.now()-dispatchClock!,origin:'provider',delivery:'response-received',
        promptTokens:this.record.promptTokens,completionTokens:this.record.completionTokens,
        cachedPromptTokens:this.record.cachedPromptTokens,reasoningOutputTokens:this.record.reasoningOutputTokens});
      this.record={...this.record,timing:{...this.record.timing!,providerEndedAt:new Date().toISOString(),
        providerDurationMs:Math.max(0,performance.now()-dispatchClock!)}};
      this.record={...status(this.record),outcome:finish==='length'?'truncated':'finalizing',endedAt:new Date().toISOString()};
      await save();d.check();yield {type:'end'};
    }catch(error){
      if(pendingIdentity){
        await pendingIdentity.catch(()=>undefined);
      }
      const sourceError = identityFailure ?? error;
      const fault=d.signal.aborted&&!identityFailure?d.failure():sourceError instanceof AppError?sourceError:new AppError('PROVIDER_ERROR','The model service could not answer.',false);
      this.record={...status(this.record),outcome:fault.code==='CANCELLED'?'cancelled':fault.code==='INTERRUPTED'||fault.code==='TIMEOUT'?'interrupted':'failed',endedAt:new Date().toISOString()};
      // A separate finite cleanup budget allows cancellation accounting to persist.
      const cleanup=new AbortController();
      accountingSignal = cleanup.signal;
      try{
        if(started){
          if(writer){
            writer.enqueue(this.record);
            await writer.close();
          }else{
            await this.accounting.save(this.record,cleanup.signal);
          }
        }
      }catch{throw new AppError('PERSISTENCE_ERROR','The chat accounting could not be saved.',false);}
      throw fault;
    }finally{
      streamTiming?.end(false);
      d.stop();d.dispose();
      if(pendingIdentity){
        await pendingIdentity.catch(()=>undefined);
      }
      if(writer){
        await writer.close().catch(()=>undefined);
      }
      await http?.body?.cancel().catch(()=>undefined);
      // Iterator return is not provider success: P5 marks interrupted/cancelled and saves final outcome.
    }
  }
}
