/**
 * ============================================================================
 * FILE: stream-render-browser.tsx
 * LOCATION: frontend/src/features/chat/testing/stream-render-browser.tsx
 * ============================================================================
 * PURPOSE: Check real provider/ChatView stream-only render isolation in a browser.
 * ROLE IN PROJECT: Development-only deterministic fixture with no backend/media calls.
 * KEY COMPONENTS: Memo-view counters, reducer transitions, real action identities.
 * ============================================================================
 */
import { act, useLayoutEffect, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient } from '../../../api/client.ts';

if (!import.meta.env.DEV) throw new Error('Development fixture only');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Install before importing the voice-capabilities singleton, which captures fetch.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 503 });
const { Composer } = await import('../../../components/Composer.tsx');
const { Sidebar } = await import('../../../components/Sidebar.tsx');
const { ChatView } = await import('../ChatView.tsx');
const { ChatProvider, useChat } = await import('../state/chat-context.tsx');

const counts = { sidebar: 0, composer: 0 };
const instrumented = new WeakSet<object>();
function countView(element: ReactElement, name: keyof typeof counts) {
  // Test-only instrumentation of the memo view before its first mount.
  const boundary = element.type as unknown as { type: (props: unknown) => ReactElement };
  if (instrumented.has(boundary)) return;
  instrumented.add(boundary);
  const render = boundary.type;
  boundary.type = props => { counts[name]++; return render(props); };
}

let chat: ReturnType<typeof useChat>;
export function Probe() {
  const context = useChat();
  countView(Sidebar({}), 'sidebar');
  countView(Composer({}), 'composer');
  useLayoutEffect(() => { chat = context; });
  return null;
}

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Public voice capabilities are unavailable; chat uses a local client fixture.
const client = new ApiClient({ fetch: async () => Response.json({ items: [], nextCursor: null }) });
const root = createRoot(document.getElementById('root')!);

async function run() {
  await act(async () => root.render(<ChatProvider client={client}><Probe /><ChatView /></ChatProvider>));
  await act(async () => {
    chat.dispatch({ type: 'TURN_SUBMIT_START', payload: { userContent: 'Check', idempotencyKey: 'test' } });
    chat.dispatch({ type: 'TURN_ACCEPTED', payload: {
      sessionId: 's', turnId: 't', attemptId: 'a', userMessageId: 'u',
    } });
    chat.dispatch({ type: 'STREAM_STATUS', payload: { status: 'generating', truncated: false } });
  });
  const before = { ...counts };
  const actions = chat.actions;
  for (const text of ['Here is a chart.\n', '```chart\n', 'A: 42\n```']) {
    await act(async () => chat.dispatch({ type: 'STREAM_DELTA', payload: { text } }));
  }
  check(chat.actions === actions, 'Actions changed on stream-only delta');
  check(counts.sidebar === before.sidebar, 'Sidebar heavy view rerendered on stream-only delta');
  check(counts.composer === before.composer, 'Composer heavy view rerendered on stream-only delta');
  check(document.body.textContent!.includes('View chart'), 'Streamed Canvas card missing');
  check(document.querySelector('button[aria-label="Cancel response"]') !== null, 'Cancel response missing');
  await act(async () => chat.dispatch({ type: 'SET_DRAFT', payload: 'Follow-up' }));
  check(counts.composer > before.composer, 'Composer did not update on draft change');
  check(document.querySelector('textarea')?.value === 'Follow-up', 'Draft not rendered');
  await act(async () => chat.dispatch({ type: 'TOGGLE_SIDEBAR' }));
  check(counts.sidebar > before.sidebar, 'Sidebar did not update on navigation state');
  await act(async () => chat.dispatch({ type: 'STREAM_COMPLETED', payload: {
    assistantMessageId: 'assistant', outcome: 'completed',
  } }));
  check(document.querySelector('button[aria-label="Send message"]') !== null, 'Send not restored');
  document.getElementById('result')!.textContent =
    `PASS: 3 stream deltas; Sidebar +0 renders; Composer +0 renders; stable actions; Canvas, draft, navigation, terminal controls intact.`;
}

void run().catch(error => {
  document.getElementById('result')!.textContent = `FAIL: ${String(error)}`;
}).finally(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = originalFetch;
});
