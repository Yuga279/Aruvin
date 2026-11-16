/**
 * ============================================================================
 * FILE: accounting.spec.ts
 * LOCATION: backend/test/model/accounting.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify absolute usage normalization and bounded generation reconciliation.
 *
 * ROLE IN PROJECT:
 *    Proves missing counts stay null, explicit zero is known, duplicate frames
 *    are not summed, and GET /generation lookups never trigger chat inference.
 *
 * KEY COMPONENTS:
 *    - mergeUsage/fromGeneration: Absolute snapshot and native cost fields.
 *    - AccountingService.reconcile: Record-driven lookup with finite retries.
 * ============================================================================
 */

import { AccountingService, mergeUsage, fromGeneration, status } from '../../src/model/accounting.js';
import { GENERATION } from '../fixtures/openrouter/frames.js';
import { seed, sink, config } from './helpers.js';

it('keeps null unknown and preserves explicit zero',()=>{
  expect(status(seed()).accountingStatus).toBe('unknown');
  expect(status({...seed(),generationId:'gen_fixture'}).accountingStatus).toBe('pending');
  expect(mergeUsage(seed(),{prompt_tokens:0,completion_tokens:0,cost:0})).toMatchObject({promptTokens:0,completionTokens:0,cost:0,accountingStatus:'known'});
  expect(mergeUsage(seed(),{prompt_tokens:-1,completion_tokens:NaN,cost:Infinity})).toMatchObject({promptTokens:null,completionTokens:null,cost:null});
});
it('replaces cumulative totals; does not add duplicate frames or cached/BYOK cost',()=>{
  const first=mergeUsage({...seed(),generationId:'gen_fixture'},{prompt_tokens:12,completion_tokens:3,cost:0.00002});
  expect(mergeUsage(first,{prompt_tokens:12,completion_tokens:3,cost:0.00002,cost_details:{upstream_inference_cost:7}})).toEqual(first);
  expect(mergeUsage(first,{completion_tokens:4,cost:null})).toMatchObject({promptTokens:12,completionTokens:4,cost:0.00002});
});
it('lookup uses native counts and total_cost, checking exact generation identity',()=>{
  expect(fromGeneration({...seed(),generationId:'gen_fixture'},GENERATION)).toMatchObject({promptTokens:12,completionTokens:3,cost:0.00002,reportedProvider:'Fixture',accountingStatus:'known'});
  expect(()=>fromGeneration({...seed(),generationId:'gen_other'},GENERATION)).toThrow();
});
it('repeated reconciliation puts the same scoped absolute snapshot',async()=>{
  const repo=sink();const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify(GENERATION)));
  const service=new AccountingService(config(),repo,fetcher);
  const original={...seed(),generationId:'gen_fixture',accountingStatus:'pending' as const,outcome:'interrupted' as const};
  const first=await service.reconcile(original,new AbortController().signal);
  const second=await service.reconcile(original,new AbortController().signal);
  expect(first).toEqual(second);expect(first.outcome).toBe('interrupted');
  expect(repo.putAccounting.mock.calls[0][0]).toEqual(repo.putAccounting.mock.calls[1][0]);
  expect(String(fetcher.mock.calls[0][0])).toContain('generation?id=gen_fixture');
});
it('repeated cost-only reconciliation preserves its first financial observation with tokens still unavailable', async () => {
  const repo = sink(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: { id: 'gen_fixture', total_cost: 0.1 } }));
  const service = new AccountingService(config(), repo, fetcher);
  const original = { ...seed(), generationId: 'gen_fixture', outcome: 'interrupted' as const };
  const first = await service.reconcile(original, new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await service.reconcile(original, new AbortController().signal);
  expect(second.money).toEqual(first.money);
  expect(second.promptTokens).toBeNull(); expect(second.accountingStatus).toBe('unknown');
});
it('never uses a cached snapshot to hide conflicting caller financial evidence', async () => {
  const repo = sink(); const service = new AccountingService(config(), repo);
  const known = { ...seed(), generationId: 'gen_fixture', promptTokens: 12, completionTokens: 3, cost: 0.1, accountingStatus: 'known' as const };
  await service.save(known, new AbortController().signal);
  await service.reconcile({ ...known, cost: 0.2 }, new AbortController().signal);
  expect(repo.putAccounting.mock.calls.at(-1)?.[0].cost).toBe(0.2);
  // The repository's immutable evidence guard must see the incoming value, not a silent cache replacement.
});
it('has no-ID fallback and bounded 404/unavailable reconciliation without inference',async()=>{
  const repo=sink();const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({error:{code:404}}),{status:404}));
  const service=new AccountingService({...config(),budgets:{...config().budgets,retryBaseDelayMs:1,retryMaxDelayMs:2}},repo,fetcher,()=>0);
  expect((await service.reconcile(seed(),new AbortController().signal)).accountingStatus).toBe('unknown');expect(fetcher).not.toHaveBeenCalled();
  const r=await service.reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal);
  expect(r.accountingStatus).toBe('unknown');expect(r.cost).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
});
it('retries eventual lookup once and preserves token/cost zero',async()=>{
  const c={...config(),budgets:{...config().budgets,retryBaseDelayMs:1,retryMaxDelayMs:2}};
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}',{status:404})).mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'gen_fixture',native_tokens_prompt:0,native_tokens_completion:0,total_cost:0}})));
  expect(await new AccountingService(c,sink(),f,()=>0).reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal)).toMatchObject({cost:0,promptTokens:0,completionTokens:0,accountingStatus:'known'});expect(f).toHaveBeenCalledTimes(2);
});
it('does not reinterpret string/different-tokenizer/BYOK fields as billing',()=>{
  expect(fromGeneration({...seed(),generationId:'gen_fixture'},{data:{id:'gen_fixture',tokens_prompt:99,tokens_completion:99,native_tokens_prompt:'12',native_tokens_completion:-1,total_cost:'0.5',upstream_inference_cost:7}})).toMatchObject({promptTokens:null,completionTokens:null,cost:null,accountingStatus:'pending'});
});
it('encodes ID and rejects foreign user/requested model before lookup',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{bad'));
  const service=new AccountingService(config(),sink(),f);
  await service.reconcile({...seed(),generationId:'gen/a?x=1'},new AbortController().signal);expect(String(f.mock.calls[0][0])).toContain('gen%2Fa%3Fx%3D1');
  const before=f.mock.calls.length;
  await expect(service.reconcile({...seed(),userId:'other',generationId:'gen_fixture'},new AbortController().signal)).rejects.toThrow();
  await expect(service.reconcile({...seed(),requestedModel:'other',generationId:'gen_fixture'},new AbortController().signal)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(before);
});
it.each([401,402,403])('surfaces lookup auth/credit %i once',async code=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:code}));
  await expect(new AccountingService(config(),sink(),f).reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);
});
it.each(['{bad','x'.repeat(65537),JSON.stringify({data:{id:'gen_fixture',native_tokens_prompt:12}})])('keeps unavailable/partial lookup unknown',async body=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
  expect((await new AccountingService(config(),sink(),f).reconcile({...seed(),generationId:'gen_fixture'},new AbortController().signal)).accountingStatus).toBe('unknown');expect(f).toHaveBeenCalledTimes(1);
});
it('save failure is not successful reconciliation and snapshot is scope checked',async()=>{
  const repo=sink();const service=new AccountingService(config(),repo);
  await service.save(seed(),new AbortController().signal);expect(service.snapshot('aurvin-dev-user','sess_fixture','att_fixture')).toEqual(seed());expect(service.snapshot('other','sess_fixture','att_fixture')).toBeNull();
  repo.putAccounting.mockRejectedValue(new Error('private'));
  await expect(service.reconcile(seed(),new AbortController().signal)).rejects.toMatchObject({code:'PERSISTENCE_ERROR'});
});
it('distinct retry attempts preserve two durable identities, not a summed generation',async()=>{
  const rows=new Map<string,unknown>();const repo={putAccounting:async(r:ReturnType<typeof seed>)=>{rows.set(`${r.userId}/${r.sessionId}/${r.attemptId}/${r.generationId}`,r);}};
  const service=new AccountingService(config(),repo);
  await service.save({...seed(),generationId:'gen_1',cost:0.1},new AbortController().signal);
  await service.save({...seed(),attemptId:'att_retry',generationId:'gen_2',cost:0.2},new AbortController().signal);expect(rows.size).toBe(2);
});
it('bounds hung lookup body, preserves outcome and never sends a chat POST',async()=>{
  vi.useFakeTimers();
  try{
    const c={...config(),budgets:{...config().budgets,connectTimeoutMs:5}};
    const f=vi.fn<typeof fetch>().mockImplementation(async(_,init)=>new Response(new ReadableStream<Uint8Array>({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});}})));
    const pending=new AccountingService(c,sink(),f).reconcile({...seed(),generationId:'gen_fixture',outcome:'cancelled'},new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);expect(await pending).toMatchObject({accountingStatus:'unknown',outcome:'cancelled',cost:null});expect(f).toHaveBeenCalledTimes(1);expect(String(f.mock.calls[0][0])).toContain('/generation?');expect(f.mock.calls[0][1]?.method).not.toBe('POST');expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
});
it('external lookup abort is explicit and does not mutate another scope',async()=>{
  const outer=new AbortController();outer.abort();const repo=sink(),f=vi.fn<typeof fetch>();
  await expect(new AccountingService(config(),repo,f).reconcile({...seed(),generationId:'gen_fixture'},outer.signal)).rejects.toMatchObject({code:'CANCELLED'});expect(f).not.toHaveBeenCalled();expect(repo.putAccounting).not.toHaveBeenCalled();
});
