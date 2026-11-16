/**
 * ============================================================================
 * FILE: policy.spec.ts
 * LOCATION: backend/test/model/policy.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify OpenRouter request identity, privacy, compression, and budget policy.
 *
 * ROLE IN PROJECT:
 *    Contract-tests the actual ChatOpenRouter outgoing JSON so P4 cannot dispatch
 *    a request that leaks client identity, enables transforms, or silently
 *    discards context when a bound is exceeded.
 *
 * KEY COMPONENTS:
 *    - Wire-body assertions: user, model, max_tokens, plugins, and privacy.
 *    - Policy mismatch tests: reject overrides before any provider dispatch.
 * ============================================================================
 */

import { loadConfig } from '../../src/platform/config/load-config.js';
import { buildBody, assertRequest, type ModelLimits } from '../../src/model/policy.js';
import type { ModelInvokeRequest } from '../../src/contracts/runtime.js';

const config = loadConfig({ OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model' });
const limits: ModelLimits = { modelId: 'fixture/model', contextTokens: 32768, outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' };
const request = (): ModelInvokeRequest => ({ modelId: config.openRouter.modelId, user: config.identity.userId, messages: [{role:'system',content:'Rules'}, {role:'user',content:'Hello'}], maxOutputTokens: 2048, abortSignal: new AbortController().signal, transforms: [], dataCollection:'deny' });

it('serializes user/model/caps/privacy and explicit compression disable', () => {
  const body = JSON.parse(JSON.stringify(buildBody(config, limits, request())));
  expect(body).toMatchObject({model:'fixture/model',user:'aurvin-dev-user',max_tokens:2048,stream:true,stream_options:{include_usage:true},transforms:[],provider:{data_collection:'deny',require_parameters:true}});
  expect(body.plugins).toContainEqual({id:'context-compression',enabled:false});
  expect(body.messages).toEqual(request().messages);
  for (const field of ['models','route','tools','tool_choice','apiKey','reasoning']) expect(body[field]).toBeUndefined();
});
it('uses allow only when explicitly configured on the server',()=>{
  const allowed={...config,openRouter:{...config.openRouter,dataCollection:'allow' as const}};
  expect(buildBody(allowed,limits,{...request(),dataCollection:'allow'}).provider).toMatchObject({data_collection:'allow'});
});
it.each([
  {modelId:'other/model'}, {user:'browser-user'}, {transforms:['middle-out']}, {dataCollection:'allow'}, {maxOutputTokens:2049}, {maxOutputTokens:Infinity},
])('rejects internal policy mismatch before dispatch: %j', change => {
  expect(() => assertRequest(config,limits,{...request(),...change} as ModelInvokeRequest)).toThrow();
});
it('rejects absent/undersized model capabilities and enabled transforms', () => {
  expect(() => buildBody(config,{...limits,contextTokens:8192},request())).toThrow();
  expect(() => buildBody(config,{...limits,outputTokens:1024},request())).toThrow();
  expect(() => buildBody(config,{...limits,supportsMaxTokens:false},request())).toThrow();
  expect(() => buildBody({...config,openRouter:{...config.openRouter,disableTransforms:false}},limits,request())).toThrow();
});
it('fails overflow rather than removing context', () => {
  const r = {...request(),messages:[{role:'user' as const,content:'x'.repeat(9000)}]};
  expect(() => assertRequest(config,limits,r)).toThrow();
  expect(r.messages[0].content).toHaveLength(9000);
  expect(() => assertRequest(config,limits,{...request(),messages:Array.from({length:81},() => ({role:'user' as const,content:'x'}))})).toThrow();
});
it('rejects native tool messages on the ordinary text body path', () => {
  const r = {...request(),messages:[...request().messages,{role:'tool' as 'assistant',content:'{"ok":true}'}]};
  expect(() => buildBody(config,limits,r)).toThrow();
});
