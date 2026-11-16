/**
 * ============================================================================
 * FILE: adapter.spec.ts
 * LOCATION: backend/test/model/adapter.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify one-shot OpenRouter attempt streaming and honest terminal outcomes.
 *
 * ROLE IN PROJECT:
 *    Fixture-drives the adapter through injected fetch so identity, usage,
 *    cancellation, retry, and persistence hooks can be proven without live
 *    inference or a second model request.
 *
 * KEY COMPONENTS:
 *    - Wire and stream tests: Outgoing body, comments, IDs, usage, and end.
 *    - Failure tests: EOF, HTTP-200 errors, abort, retry bounds, and timeouts.
 * ============================================================================
 */

import { OpenRouterAttemptAdapter } from '../../src/model/openrouter-adapter.js';
import { AccountingService } from '../../src/model/accounting.js';
import { FRAMES, chunk, usage, done } from '../fixtures/openrouter/frames.js';
import { config, limits, request, seed, sink, response, collect } from './helpers.js';
import type { ModelChunk } from '../../src/contracts/runtime.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { ports, request as contextRequest } from '../context/fixtures.js';
import type { ContextChatMessage } from '../../src/contracts/context.js';

function harness(text=FRAMES.normal,c=config(),random:()=>number=()=>0,supervised=false){
  const repo=sink();const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response(text));
  const onId=vi.fn<(id:string)=>Promise<void>>().mockResolvedValue(undefined);
  const adapter=new OpenRouterAttemptAdapter(c,limits,seed(),new AccountingService(c,repo,fetcher),onId,fetcher,random,undefined,
    supervised ? { track: promise => promise, fail: () => {} } : undefined);
  return {adapter,repo,fetcher,onId};
}
afterEach(()=>vi.useRealTimers());
it.each([false, true])('overlaps identity writes but gates text on both acknowledgments (supervised=%s)', async supervised => {
  vi.useFakeTimers();
  const h = harness(FRAMES.noUsage, config(), () => 0, supervised);
  const started: number[] = [];
  h.onId.mockImplementation(async () => {
    started.push(Date.now());
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  h.repo.putAccounting.mockImplementation(async record => {
    if (record.generationId && record.outcome === 'generating' && !record.timing?.firstOutputAt) {
      started.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  });
  const output: ModelChunk[] = [];
  const result = (async () => { for await (const item of h.adapter.stream(request())) output.push(item); })();
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toHaveLength(2);
  expect(new Set(started).size).toBe(1);
  await vi.advanceTimersByTimeAsync(40);
  expect(output.some(item => item.type === 'delta')).toBe(false);
  await vi.advanceTimersByTimeAsync(20);
  await result;
  expect(output.some(item => item.type === 'delta')).toBe(true);
  expect(output.at(-1)?.type).toBe('end');
});
it.each([false, true])('drains the accounting sibling before identity failure cleanup (supervised=%s)', async supervised => {
  vi.useFakeTimers();
  const h = harness(FRAMES.noUsage, config(), () => 0, supervised);
  h.onId.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    throw new Error('identity unavailable');
  });
  h.repo.putAccounting.mockImplementation(async record => {
    if (record.generationId && record.outcome === 'generating')
      await new Promise(resolve => setTimeout(resolve, 60));
  });
  const output: ModelChunk[] = [];
  const result = expect((async () => {
    for await (const item of h.adapter.stream(request())) output.push(item);
  })()).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await vi.advanceTimersByTimeAsync(20);
  expect(h.repo.putAccounting.mock.calls.map(([r]) => r.outcome)).toEqual(['generating', 'generating']);
  expect(output.some(item => item.type === 'delta' || item.type === 'end')).toBe(false);
  await vi.advanceTimersByTimeAsync(40);
  await result;
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({ outcome: 'failed', generationId: 'gen_fixture' });
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it.each([false, true])('fails closed if parallel identity accounting fails (supervised=%s)', async supervised => {
  const h = harness(FRAMES.noUsage, config(), () => 0, supervised);
  h.repo.putAccounting.mockImplementation(async record => {
    if (record.generationId && record.outcome === 'generating') throw new Error('accounting unavailable');
  });
  const output: ModelChunk[] = [];
  await expect((async () => {
    for await (const item of h.adapter.stream(request())) output.push(item);
  })()).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  expect(output.some(item => item.type === 'delta' || item.type === 'end')).toBe(false);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it.each([false, true])('drains terminal accounting before end (supervised=%s)', async supervised => {
  vi.useFakeTimers();
  const h = harness(FRAMES.noUsage, config(), () => 0, supervised);
  h.repo.putAccounting.mockImplementation(async record => {
    if (record.outcome === 'finalizing') await new Promise(resolve => setTimeout(resolve, 60));
  });
  const output: ModelChunk[] = [];
  const result = (async () => { for await (const item of h.adapter.stream(request())) output.push(item); })();
  await vi.advanceTimersByTimeAsync(0);
  expect(output.some(item => item.type === 'delta')).toBe(true);
  expect(output.some(item => item.type === 'end')).toBe(false);
  await vi.advanceTimersByTimeAsync(60);
  await result;
  expect(output.at(-1)?.type).toBe('end');
});
it.each([false, true])('cancels during identity persistence without text, end, or redispatch (supervised=%s)', async supervised => {
  vi.useFakeTimers();
  const h = harness(FRAMES.noUsage, config(), () => 0, supervised);
  const controller = new AbortController();
  h.onId.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  const output: ModelChunk[] = [];
  const result = expect((async () => {
    for await (const item of h.adapter.stream(request(controller.signal))) output.push(item);
  })()).rejects.toMatchObject({ code: 'CANCELLED' });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(40);
  await result;
  expect(output.some(item => item.type === 'delta' || item.type === 'end')).toBe(false);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).toBe('cancelled');
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it.each([false, true])('acknowledges possible-billing evidence for every provider retry (supervised=%s)', async supervised => {
  const h = harness(FRAMES.normal, config(), () => 0, supervised);
  h.fetcher.mockImplementation(async () => {
    const dispatch = h.fetcher.mock.calls.length;
    expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].timing?.dispatchCount).toBe(dispatch);
    return dispatch === 1 ? new Response('{"error":{"code":503}}', { status: 503 }) : response(FRAMES.normal);
  });
  await collect(h.adapter.stream(request()));
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  expect(h.onId).toHaveBeenCalledTimes(1);
});
it.each([false, true])('persists only the dispatch-bearing snapshot before fetch (supervised=%s)', async supervised => {
  const h = harness(FRAMES.normal, config(), () => 0, supervised);
  let savesAtFetch = 0;
  h.fetcher.mockImplementation(async () => {
    savesAtFetch = h.repo.putAccounting.mock.calls.length;
    return response(FRAMES.normal);
  });
  await collect(h.adapter.stream(request()));
  expect(savesAtFetch).toBe(1);
  expect(h.repo.putAccounting.mock.calls[0][0].timing).toMatchObject({ dispatchCount: 1 });
  expect(h.repo.putAccounting.mock.calls[0][0].timing?.dispatchedAt).toMatch(/Z$/);
  const failed = harness(FRAMES.normal, config(), () => 0, supervised);
  failed.repo.putAccounting.mockRejectedValue(new Error('storage unavailable'));
  await expect(collect(failed.adapter.stream(request()))).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  expect(failed.fetcher).not.toHaveBeenCalled();
});
it.each([false, true])('waits for dispatch acknowledgment before fetch (supervised=%s)', async supervised => {
  const h = harness(FRAMES.normal, config(), () => 0, supervised);
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  let acknowledge!: () => void;
  h.repo.putAccounting.mockImplementationOnce(async () => {
    entered();
    await new Promise<void>(resolve => { acknowledge = resolve; });
  });
  const result = collect(h.adapter.stream(request()));
  await pending;
  expect(h.fetcher).not.toHaveBeenCalled();
  acknowledge();
  await result;
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('sends server identity/caps/privacy and preserves comment/id/delta/usage/end',async()=>{
  const h=harness();const out=await collect(h.adapter.stream(request()));
  expect(out.map(c=>c.type)).toEqual(['comment','generation-id','delta','usage','end']);
  expect(out.find(c=>c.type==='usage')).toMatchObject({promptTokens:12,completionTokens:3,cost:0.00002,accountingStatus:'known'});
  expect(h.onId).toHaveBeenCalledWith('gen_fixture');
  const body=JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
  expect(body).toMatchObject({user:'aurvin-dev-user',model:'fixture/model',max_tokens:2048,transforms:[],provider:{data_collection:'deny'}});
  expect(body.plugins).toContainEqual({id:'context-compression',enabled:false});
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({generationId:'gen_fixture',reportedProvider:'Fixture',cost:0.00002,outcome:'finalizing'});
});
it('measures dispatch and first nonempty output once, separately from acceptance', async () => {
  const h = harness(); await collect(h.adapter.stream(request()));
  const timing = h.repo.putAccounting.mock.calls.at(-1)?.[0].timing;
  expect(timing).toMatchObject({ dispatchCount: 1, durableCompletedAt: null });
  expect(timing?.dispatchedAt).not.toBe(seed().startedAt);
  expect(timing?.firstOutputAt).toMatch(/Z$/);
  expect(timing?.providerEndedAt).toMatch(/Z$/);
  expect(timing?.providerDurationMs).toBeGreaterThanOrEqual(timing?.firstOutputLatencyMs ?? Infinity);
});
it('leaves first output unavailable on error/empty streams and counts rejection dispatches', async () => {
  const h = harness(FRAMES.errorBefore);
  await expect(collect(h.adapter.stream(request()))).rejects.toThrow();
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].timing).toMatchObject({ firstOutputAt: null,
    firstOutputLatencyMs: null, providerEndedAt: null, providerDurationMs: null, dispatchCount: 1 });
  const retry = harness(); retry.fetcher.mockReset().mockResolvedValueOnce(new Response('{"error":{"code":429}}', { status: 429 }))
    .mockResolvedValueOnce(response(FRAMES.normal));
  await collect(retry.adapter.stream(request()));
  expect(retry.repo.putAccounting.mock.calls.at(-1)?.[0].timing?.dispatchCount).toBe(2);
});
it('ignores empty deltas and measures only the first of multiple nonempty deltas', async () => {
  const h = harness(chunk('') + chunk('A') + usage + chunk('B') + chunk('', 'stop') + done);
  const output = await collect(h.adapter.stream(request()));
  expect(output.filter(c => c.type === 'delta')).toHaveLength(2);
  const observations = h.repo.putAccounting.mock.calls.map(([r]) => r.timing?.firstOutputAt).filter(v => v !== null && v !== undefined);
  expect(observations.length).toBeGreaterThanOrEqual(2);
  expect(new Set(observations).size).toBe(1);
  const empty = harness(chunk('', 'stop') + done); await collect(empty.adapter.stream(request()));
  expect(empty.repo.putAccounting.mock.calls.at(-1)?.[0].timing).toMatchObject({ firstOutputAt: null, firstOutputLatencyMs: null });
});
it.each(['errorBefore','errorAfter','eof','finishEof','onlyDone','malformed','differentId','contentFilter','tools'] as const)('does not emit end or re-infer on %s',async name=>{
  const h=harness(FRAMES[name]);const out:ModelChunk[]=[];
  await expect((async()=>{for await(const c of h.adapter.stream(request()))out.push(c);})()).rejects.toThrow();
  expect(out.some(c=>c.type==='end')).toBe(false);expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).not.toBe('completed');
});
it('length remains distinct; repeated usage is not double-summed',async()=>{
  const h=harness(FRAMES.length);expect((await collect(h.adapter.stream(request()))).map(c=>c.type)).toContain('length');
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).toBe('truncated');
  const dup=harness(FRAMES.duplicateUsage);const out=await collect(dup.adapter.stream(request()));
  expect(out.filter(c=>c.type==='usage')).toHaveLength(1);expect(dup.repo.putAccounting.mock.calls.at(-1)?.[0].cost).toBe(0.00002);
});
it('discards private reasoning and leaves missing usage pending',async()=>{
  const h=harness(FRAMES.reasoning);const out=await collect(h.adapter.stream(request()));
  expect(JSON.stringify(out)).not.toContain('private');expect(out).toContainEqual({type:'delta',text:'Visible'});
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({cost:null,accountingStatus:'pending'});
});
it('never dispatches if already cancelled or identity mismatches',async()=>{
  const h=harness();const abort=new AbortController();abort.abort();
  await expect(collect(h.adapter.stream(request(abort.signal)))).rejects.toMatchObject({code:'CANCELLED'});expect(h.fetcher).not.toHaveBeenCalled();
  const other=harness();await expect(collect(other.adapter.stream({...request(),user:'other'}))).rejects.toThrow();expect(other.fetcher).not.toHaveBeenCalled();
});
it('awaits generation durability before visible text and blocks on persistence failure',async()=>{
  const h=harness();h.onId.mockRejectedValue(new Error('private database text'));
  await expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('refuses accidental adapter reuse',async()=>{
  const h=harness();await collect(h.adapter.stream(request()));await expect(collect(h.adapter.stream(request()))).rejects.toThrow();expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it.each([false, true])('propagates external abort after partial output and never emits end (supervised=%s)',async supervised=>{
  const h=harness(FRAMES.normal,config(),()=>0,supervised);const controller=new AbortController();const out:ModelChunk[]=[];
  await expect((async()=>{for await(const c of h.adapter.stream(request(controller.signal))){out.push(c);if(c.type==='delta')controller.abort();}})()).rejects.toMatchObject({code:'CANCELLED'});
  expect(out.some(c=>c.type==='end')).toBe(false);expect(h.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0].outcome).toBe('cancelled');
});
it('retries one definitive 429 without multiplying attempts or changing user',async()=>{
  const h=harness();h.fetcher.mockReset();
  h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:429}}),{status:429}));
  h.fetcher.mockResolvedValueOnce(response(FRAMES.normal));
  await collect(h.adapter.stream(request()));expect(h.fetcher).toHaveBeenCalledTimes(2);
  for(const call of h.fetcher.mock.calls)expect(JSON.parse(String(call[1]?.body)).user).toBe('aurvin-dev-user');
});
it.each([401,402,400,413,500,502,504])('does not auto-retry HTTP %i',async status=>{
  const h=harness();h.fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({error:{code:status}}),{status}));
  await expect(collect(h.adapter.stream(request()))).rejects.toThrow();expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('caps repeated definitive rejection at configured attempts',async()=>{
  const h=harness();h.fetcher.mockReset().mockImplementation(async()=>new Response(JSON.stringify({error:{code:503}}),{status:503}));
  await expect(collect(h.adapter.stream(request()))).rejects.toThrow();expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('does not retry network ambiguity, malformed error bodies or generated rejection',async()=>{
  const network=harness();network.fetcher.mockRejectedValue(new TypeError('private socket detail'));
  await expect(collect(network.adapter.stream(request()))).rejects.toMatchObject({code:'INTERRUPTED'});expect(network.fetcher).toHaveBeenCalledTimes(1);
  const malformed=harness();malformed.fetcher.mockResolvedValue(new Response('{bad',{status:503}));
  await expect(collect(malformed.adapter.stream(request()))).rejects.toThrow();expect(malformed.fetcher).toHaveBeenCalledTimes(1);
  const generated=harness();generated.fetcher.mockResolvedValue(new Response(JSON.stringify({id:'gen_fixture',error:{code:503}}),{status:503}));
  await expect(collect(generated.adapter.stream(request()))).rejects.toThrow();expect(generated.fetcher).toHaveBeenCalledTimes(1);expect(generated.onId).toHaveBeenCalled();
});
it('aborts upstream when the consumer returns early',async()=>{
  const h=harness();const iterator=h.adapter.stream(request());await iterator.next();await iterator.return(undefined);
  expect(h.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it('does not emit provider end when terminal accounting persistence fails',async()=>{
  const h=harness(FRAMES.noUsage);
  h.repo.putAccounting.mockImplementation(async r=>{if(r.outcome==='finalizing')throw new Error('private storage error');});
  const out:ModelChunk[]=[];await expect((async()=>{for await(const c of h.adapter.stream(request()))out.push(c);})()).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});
  expect(out.some(c=>c.type==='end')).toBe(false);expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('retains billing attached to an HTTP-200 error without claiming answer success',async()=>{
  const h=harness(FRAMES.errorUsage);const out:ModelChunk[]=[];
  await expect((async()=>{for await(const item of h.adapter.stream(request()))out.push(item);})()).rejects.toMatchObject({code:'PROVIDER_ERROR'});
  expect(out).toContainEqual({type:'usage',promptTokens:12,completionTokens:3,cost:0.00002,accountingStatus:'known'});
  expect(out.some(x=>x.type==='end')).toBe(false);expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({accountingStatus:'known',cost:0.00002,outcome:'failed'});
});
it('times out hung headers without another POST',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,connectTimeoutMs:5,totalRunTimeoutMs:100}};const h=harness(FRAMES.normal,c);
  h.fetcher.mockImplementation(async(_,init)=>new Promise<Response>((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('processing comments cannot evade first-output deadline',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,firstOutputTimeoutMs:5,idleStreamTimeoutMs:4,totalRunTimeoutMs:100}};const h=harness(FRAMES.normal,c);
  h.fetcher.mockImplementation(async(_,init)=>new Response(new ReadableStream<Uint8Array>({start(controller){
    const timer=setInterval(()=>controller.enqueue(new TextEncoder().encode(': processing\n\n')),2);
    init?.signal?.addEventListener('abort',()=>{clearInterval(timer);controller.error(new Error('aborted'));},{once:true});
  }}),{headers:{'content-type':'text/event-stream'}}));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('stalled body after first delta preserves generation accounting and times out idle',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,idleStreamTimeoutMs:5,totalRunTimeoutMs:100}};const h=harness(FRAMES.normal,c);
  h.fetcher.mockImplementation(async(_,init)=>new Response(new ReadableStream<Uint8Array>({start(controller){
    controller.enqueue(new TextEncoder().encode('data: {"id":"gen_fixture","choices":[{"index":0,"delta":{"content":"Partial"},"finish_reason":null}]}\n\n'));
    init?.signal?.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});
  }}),{headers:{'content-type':'text/event-stream'}}));
  const out:ModelChunk[]=[];const result=expect((async()=>{for await(const item of h.adapter.stream(request()))out.push(item);})()).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(out).toContainEqual({type:'delta',text:'Partial'});expect(out.some(x=>x.type==='end')).toBe(false);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({generationId:'gen_fixture',outcome:'interrupted',cost:null});expect(vi.getTimerCount()).toBe(0);
});
it('total deadline includes rejected backoff without another POST',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,totalRunTimeoutMs:5,retryBaseDelayMs:10,retryMaxDelayMs:20}};const h=harness(FRAMES.normal,c,()=>1);
  h.fetcher.mockImplementation(async()=>new Response(JSON.stringify({error:{code:503}}),{status:503}));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'TIMEOUT'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('generation hook timeout keeps received ID for accounting and never infers twice',async()=>{
  vi.useFakeTimers();const c={...config(),budgets:{...config().budgets,persistenceTimeoutMs:5}};const h=harness(FRAMES.normal,c);h.onId.mockImplementation(async()=>new Promise<void>(()=>undefined));
  const result=expect(collect(h.adapter.stream(request()))).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});
  await vi.advanceTimersByTimeAsync(10);await result;expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.repo.putAccounting.mock.calls.at(-1)?.[0]).toMatchObject({generationId:'gen_fixture',outcome:'failed'});expect(vi.getTimerCount()).toBe(0);
});
it('fails invalid UTF-8 and missing/wrong-content-type body without end',async()=>{
  const bad=harness();bad.fetcher.mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close();}}),{headers:{'content-type':'text/event-stream'}}));
  await expect(collect(bad.adapter.stream(request()))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
  const absent=harness();absent.fetcher.mockResolvedValue(new Response(null,{headers:{'content-type':'text/event-stream'}}));await expect(collect(absent.adapter.stream(request()))).rejects.toThrow();
  const wrong=harness();wrong.fetcher.mockResolvedValue(new Response('{}',{headers:{'content-type':'application/json'}}));await expect(collect(wrong.adapter.stream(request()))).rejects.toThrow();
});
it('rejects the violating output delta before yielding it',async()=>{
  const text='x'.repeat(32001);const stream='data: '+JSON.stringify({id:'gen_fixture',choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n';
  const h=harness(stream);const out:ModelChunk[]=[];
  await expect((async()=>{for await(const item of h.adapter.stream(request()))out.push(item);})()).rejects.toMatchObject({code:'STORAGE_BUDGET_EXCEEDED'});
  expect(out.some(x=>x.type==='delta'||x.type==='end')).toBe(false);expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('uses initial snapshot retryMaxAttempts and delay for automatic backoff', async () => {
  vi.useFakeTimers();
  const c = { ...config(), budgets: { ...config().budgets, retryMaxAttempts: 3, retryBaseDelayMs: 25, retryMaxDelayMs: 100 } };
  const h = harness(FRAMES.normal, c, () => 0);
  h.fetcher.mockReset()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }))
    .mockResolvedValueOnce(response(FRAMES.normal));
  const streamPromise = collect(h.adapter.stream(request()));
  await vi.advanceTimersByTimeAsync(25);
  await vi.advanceTimersByTimeAsync(50);
  const out = await streamPromise;
  expect(out.some(c => c.type === 'end')).toBe(true);
  expect(h.fetcher).toHaveBeenCalledTimes(3);
});

it('keeps the assembled fixed-pair/leading selector prefix in outbound JSON', async () => {
  const assembler = new ReferencedContextAssembler(ports());
  const bodies: { messages: ContextChatMessage[]; user: string; model: string }[] = [];
  for (const responseMode of ['text', 'voice'] as const) {
    const assembled = await assembler.assemble({ ...contextRequest, responseMode });
    if (!assembled.ok) throw new Error('expected context');
    const h = harness();
    await collect(h.adapter.stream({ ...request(), messages: assembled.context.messages }));
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(body.messages).toEqual(assembled.context.messages);
    expect(body.messages.map((message: ContextChatMessage) => message.role))
      .toEqual(['system', 'system', 'system', 'system', 'user', 'assistant', 'user']);
    expect(body.messages[3]).toEqual({ role: 'system', content: `Response mode: ${responseMode}.` });
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: contextRequest.newUserInput });
    expect(body.user).toBe(config().identity.userId);
    expect(body.model).toBe(config().openRouter.modelId);
    bodies.push(body);
  }
  expect(bodies[1].messages.slice(0, 3)).toEqual(bodies[0].messages.slice(0, 3));
  expect(bodies[1].messages.slice(4)).toEqual(bodies[0].messages.slice(4));
  expect(JSON.stringify(bodies[1].messages.slice(4)))
    .toBe(JSON.stringify(bodies[0].messages.slice(4)));
});

