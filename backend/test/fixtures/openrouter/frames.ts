/**
 * ============================================================================
 * FILE: frames.ts
 * LOCATION: backend/test/fixtures/openrouter/frames.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide deterministic OpenRouter SSE and generation lookup fixtures.
 *
 * ROLE IN PROJECT:
 *    Supplies raw stream frames for P4 adapter tests so outcomes can be
 *    proven without live networking, billed inference, or production payloads.
 *
 * KEY COMPONENTS:
 *    - FRAMES: Comment, usage, length, error, EOF, and identity variants.
 *    - GENERATION: Native token/cost lookup envelope with ignored BYOK fields.
 * ============================================================================
 */

const event=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
export const chunk=(content:string,finish_reason:string|null=null)=>event({id:'gen_fixture',model:'fixture/model',provider:'Fixture',choices:[{index:0,delta:{content},finish_reason}]});
export const usage=event({id:'gen_fixture',choices:[],usage:{prompt_tokens:12,completion_tokens:3,total_tokens:15,cost:0.00002}});
export const done='data: [DONE]\n\n';
export const FRAMES={
  normal:': OPENROUTER PROCESSING\n\n'+chunk('Hello 🌍')+chunk('','stop')+usage+done,
  length:chunk('Partial')+chunk('','length')+usage+done,
  noUsage:chunk('Hello')+chunk('','stop')+done,
  duplicateUsage:chunk('Hello')+chunk('','stop')+usage+usage+done,
  errorBefore:event({id:'gen_fixture',error:{code:402,message:'private provider detail'}})+done,
  errorAfter:chunk('Partial')+event({id:'gen_fixture',choices:[{index:0,delta:{},finish_reason:'error'}],error:{code:502,message:'private provider detail'}})+done,
  errorUsage:chunk('Partial')+event({id:'gen_fixture',error:{code:502,message:'private provider detail'},usage:{prompt_tokens:12,completion_tokens:3,cost:0.00002}})+done,
  eof:chunk('Partial'),
  finishEof:chunk('Hello')+chunk('','stop')+usage,
  onlyDone:done,
  malformed:'data: {broken}\n\n'+done,
  reasoning: event({id:'gen_fixture',choices:[{index:0,delta:{reasoning:'private',content:'Visible'},finish_reason:null}]})+chunk('','stop')+done,
  differentId:chunk('A')+event({id:'gen_other',choices:[{index:0,delta:{content:'B'},finish_reason:'stop'}]})+done,
  contentFilter:chunk('')+chunk('','content_filter')+done,
  tools: event({id:'gen_fixture',choices:[{index:0,delta:{tool_calls:[{id:'call_1'}]},finish_reason:'tool_calls'}]})+done,
};
export const GENERATION={data:{id:'gen_fixture',model:'fixture/model',provider_name:'Fixture',native_tokens_prompt:12,native_tokens_completion:3,total_cost:0.00002,tokens_prompt:99,tokens_completion:99,upstream_inference_cost:7}};
