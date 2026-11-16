/**
 * ============================================================================
 * FILE: sse.spec.ts
 * LOCATION: backend/test/model/sse.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify bounded incremental UTF-8 SSE framing across packet splits.
 *
 * ROLE IN PROJECT:
 *    Proves comments, multiline data, CRLF, and size/count limits before the
 *    adapter interprets JSON, so malformed provider streams fail closed.
 *
 * KEY COMPONENTS:
 *    - Packet-width tests: Preserve emoji and DONE across 1-byte splits.
 *    - Boundary tests: Reject oversized, invalid UTF-8, and unterminated data.
 * ============================================================================
 */

import { parseSse } from '../../src/model/sse.js';
import { bytes, collect } from './helpers.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';

it.each([1,2,7,65536])('preserves UTF-8 and framing across %i-byte packets',async width=>{
  const frames=await collect(parseSse(bytes(FRAMES.normal,width)));
  expect(frames[0]).toEqual({type:'comment',text:'OPENROUTER PROCESSING'});
  expect(frames.some(f=>f.type==='data'&&f.data.includes('Hello 🌍'))).toBe(true);
  expect(frames.at(-1)).toEqual({type:'data',data:'[DONE]'});
});
it('accepts CRLF, multiline data and ignores non-data SSE fields',async()=>{
  expect(await collect(parseSse(bytes(': hi\r\nid: x\r\nevent: message\r\ndata: {\r\ndata: "ok":true}\r\n\r\n')))).toEqual([{type:'comment',text:'hi'},{type:'data',data:'{\n"ok":true}'}]);
});
it('accepts SSE lone CR delimiters without requiring LF',async()=>{
  expect(await collect(parseSse(bytes(':hi\r\rdata:[DONE]\r\r',1)))).toEqual([{type:'comment',text:'hi'},{type:'data',data:'[DONE]'}]);
});
it('rejects oversized unfinished lines/events and invalid UTF-8',async()=>{
  // The byte limits are chunk independent, so the oversized payloads use a
  // realistic packet width: byte-wise delivery of a 64 KB payload makes the
  // parser rescan its pending buffer once per byte.
  await expect(collect(parseSse(bytes('data: '+'x'.repeat(65537),4096)))).rejects.toMatchObject({code:'PROVIDER_ERROR',retryable:false});
  await expect(collect(parseSse(new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close();}})))).rejects.toThrow();
});
it('does not invent a complete event from trailing unterminated data',async()=>{
  await expect(collect(parseSse(bytes('data: {"ok":true}')))).rejects.toMatchObject({code:'INTERRUPTED'});
});
it('admits exactly bounded event bytes and rejects aggregate multiline overflow',async()=>{
  const half='x'.repeat(32767),data=`${half}\n${half}`;
  expect((await collect(parseSse(bytes(`data:${half}\ndata:${half}\n\n`,4096)))).at(-1)).toEqual({type:'data',data});
  await expect(collect(parseSse(bytes(`data:${'a'.repeat(40000)}\ndata:${'b'.repeat(40000)}\n\n`,4096)))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
});
it('bounds item count even for tiny comments',async()=>{
  await expect(collect(parseSse(bytes(':hi\n'.repeat(10001),4096)))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
});
it('bounds total bytes even when individual frames are small',async()=>{
  await expect(collect(parseSse(bytes(('ignored:'+ 'x'.repeat(1000)+'\n').repeat(1100),4096)))).rejects.toMatchObject({code:'PROVIDER_ERROR'});
});
it('comments are not JSON and CRLF segmentation is harmless',async()=>{
  expect(await collect(parseSse(bytes(': {not json}\r\n\r\ndata:[DONE]\r\n\r\n',1)))).toEqual([{type:'comment',text:'{not json}'},{type:'data',data:'[DONE]'}]);
});

