/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/http/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the public P6 chat HTTP module, options, and parser boundary.
 *
 * ROLE IN PROJECT:
 *    Gives P9 a stable import surface for register/registerAsync composition
 *    without exposing internal writer or filter files.
 *
 * KEY COMPONENTS:
 *    - ChatHttpModule / configureChatHttp: Assembly and parser installation.
 *    - ChatHttpService / ChatStreamTransport: Injected runtime and snapshot.
 * ============================================================================
 */

export { ChatHttpModule } from './chat-http.module.js';
export { ChatHttpService } from './chat-http.service.js';
export { ChatStreamTransport } from './chat-stream.transport.js';
export { configureChatHttp } from './configure-chat-http.js';
export type { ChatHttpOptions } from './options.js';
