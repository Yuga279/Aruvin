/**
 * ============================================================================
 * FILE: sse.ts
 * LOCATION: backend/src/model/sse.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse bounded incremental UTF-8 SSE frames from a raw response body.
 *
 * ROLE IN PROJECT:
 *    Preserves comments, multiline data, and [DONE] that LangChain's high-level
 *    OpenRouter stream currently discards, while enforcing finite line, event,
 *    item, and byte limits before JSON interpretation.
 *
 * KEY COMPONENTS:
 *    - SseItem: Comment or data frame yielded to the adapter state machine.
 *    - parseSse: Incremental decoder that fails closed on overflow or EOF.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';
import { TRANSPORT_LIMITS as L } from './policy.js';
export type SseItem={type:'comment';text:string}|{type:'data';data:string};
const protocol=()=>new AppError('PROVIDER_ERROR','The response stream was invalid.',false);

export async function* parseSse(stream:ReadableStream<Uint8Array>):AsyncGenerator<SseItem> {
  const reader=stream.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let pending='',data:string[]=[],eventBytes=0,total=0,count=0,closed=false;
  function line(text:string):SseItem|undefined {
    if(Buffer.byteLength(text,'utf8')>L.frameBytes)throw protocol();
    if(text==='') { if(!data.length)return; const item:SseItem={type:'data',data:data.join('\n')};data=[];eventBytes=0;return item; }
    if(text.startsWith(':'))return {type:'comment',text:text.slice(1).trimStart()};
    const colon=text.indexOf(':');
    const field=colon<0?text:text.slice(0,colon);
    let value=colon<0?'':text.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
    if(field==='data'){eventBytes+=Buffer.byteLength(value,'utf8')+1;if(eventBytes>L.frameBytes)throw protocol();data.push(value);}
  }
  try {
    while(true){
      const next=await reader.read();
      if(next.done){closed=true;try{pending+=decoder.decode();}catch{throw protocol();}}
      else{total+=next.value.byteLength;if(total>L.streamBytes)throw protocol();try{pending+=decoder.decode(next.value,{stream:true});}catch{throw protocol();}}
      let end:number;
      while((end=pending.search(/[\r\n]/))>=0){
        if(pending[end]==='\r'&&end===pending.length-1&&!next.done)break;
        const width=pending[end]==='\r'&&pending[end+1]==='\n'?2:1;
        const text=pending.slice(0,end);pending=pending.slice(end+width);
        const item=line(text);if(item){if(++count>L.frames)throw protocol();yield item;}
      }
      if(Buffer.byteLength(pending.replace(/\r$/,''),'utf8')>L.frameBytes)throw protocol();
      if(next.done)break;
    }
    if(pending || data.length)throw new AppError('INTERRUPTED','The response stream ended early.',false);
  } finally {
    if(!closed)await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
}
