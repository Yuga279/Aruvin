/**
 * ============================================================================
 * FILE: deadlines.ts
 * LOCATION: backend/src/model/deadlines.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Link abort signals, enforce finite provider deadlines, and bound JSON reads.
 *
 * ROLE IN PROJECT:
 *    Gives the adapter a single abort controller for connect/first/idle/total
 *    timeouts and cancellation, plus abortable backoff and a size-limited JSON
 *    reader that never calls unbounded Response.json.
 *
 * KEY COMPONENTS:
 *    - RunDeadlines: Linked abort/deadline controller with timer cleanup.
 *    - sleep/bounded/readJson: Abortable wait, persistence race, and body cap.
 * ============================================================================
 */

import type { BudgetConfig } from '../contracts/budgets.js';
import { AppError } from '../platform/errors/app-error.js';

export class RunDeadlines {
  private controller=new AbortController();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private timedOut=false;
  private visible=false;
  private abort=()=>this.controller.abort();
  readonly signal=this.controller.signal;
  constructor(private budgets:BudgetConfig,private outer:AbortSignal,deadlineAt?:string){
    const remaining=deadlineAt===undefined?budgets.totalRunTimeoutMs:Date.parse(deadlineAt)-Date.now();
    if(!Number.isFinite(remaining))throw new AppError('INVALID_REQUEST','The deadline is invalid.',false);
    if(outer.aborted)this.abort();
    else if(remaining<=0){this.timedOut=true;this.abort();}
    else{
      outer.addEventListener('abort',this.abort,{once:true});
      this.arm('total',Math.min(budgets.totalRunTimeoutMs,remaining));
    }
  }
  private clear(name:string){const timer=this.timers.get(name);if(timer!==undefined)clearTimeout(timer);this.timers.delete(name);}
  private arm(name:string,ms:number){this.clear(name);if(this.signal.aborted)return;this.timers.set(name,setTimeout(()=>{this.timers.delete(name);this.timedOut=true;this.controller.abort();},ms));}
  armConnect(ms=this.budgets.connectTimeoutMs){this.arm('connect',ms);}
  armFirst(ms=this.budgets.firstOutputTimeoutMs){this.arm('first',ms);}
  armIdle(ms=this.budgets.idleStreamTimeoutMs){this.arm('idle',ms);}
  headers(){this.clear('connect');this.armFirst();this.armIdle();}
  frame(){this.armIdle();}
  firstText(){if(!this.visible){this.visible=true;this.clear('first');}}
  providerFinished(){this.clear('first');this.clear('idle');}
  resetDispatch(){this.clear('connect');this.clear('first');this.clear('idle');}
  failure(){return this.timedOut?new AppError('TIMEOUT','The response took too long. Retry to continue.',false):new AppError('CANCELLED','Generation was cancelled.',false);}
  check(){if(this.signal.aborted)throw this.failure();}
  stop(){this.controller.abort();}
  dispose(){for(const name of [...this.timers.keys()])this.clear(name);this.outer.removeEventListener('abort',this.abort);}
}
export async function sleep(ms:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)throw new AppError('CANCELLED','Generation was cancelled.',false);
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new AppError('CANCELLED','Generation was cancelled.',false));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
export async function bounded<T>(job:Promise<T>,ms:number,signal:AbortSignal,code:'PERSISTENCE_ERROR'|'TIMEOUT'):Promise<T>{
  if(signal.aborted)throw new AppError('CANCELLED','Generation was cancelled.',false);
  let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:()=>void=()=>undefined;
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new AppError(code,code==='PERSISTENCE_ERROR'?'The chat accounting could not be saved.':'The request took too long.',false)),ms);
    abort=()=>reject(new AppError('CANCELLED','Generation was cancelled.',false));signal.addEventListener('abort',abort,{once:true});
  });
  try{return await Promise.race([job,deadline]);}finally{if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export async function readJson(response:Response,maxBytes:number):Promise<unknown>{
  if(!response.body)throw new AppError('PROVIDER_ERROR','The model service returned an invalid response.',false);
  const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let count=0,text='',closed=false;
  try{while(true){const next=await reader.read();if(next.done){closed=true;break;}count+=next.value.byteLength;if(count>maxBytes)throw new AppError('PROVIDER_ERROR','The model service returned an oversized response.',false);text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();return JSON.parse(text) as unknown;}
  catch{throw new AppError('PROVIDER_ERROR','The model service returned an invalid response.',false);}
  finally{if(!closed)await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
