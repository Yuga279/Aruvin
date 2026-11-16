/**
 * ============================================================================
 * FILE: dashboard-browser.tsx
 * LOCATION: frontend/src/features/admin-config/testing/dashboard-browser.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Development-only closed fixture that mounts App and runs DOM checks.
 *
 * ROLE IN PROJECT:
 *    Proves dashboard navigation and admin interactions against mocked fetch
 *    without a production route or real provider/microphone access.
 *
 * KEY COMPONENTS:
 *    - Deny-by-default fetch and media stubs installed before App import.
 *    - Ordered named checks reported into the fixture results region.
 * ============================================================================
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { STREAM_PROTOCOL_VERSION } from '../../../api/protocol.ts';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO } from '../../../api/voice-protocol.ts';
import { publicConfig } from './fixtures.ts';
import { byLabel, check, press, typeInput } from './browser-checks.ts';
import '../../../index.css';

if (!import.meta.env.DEV) {
  throw new Error('The admin dashboard browser fixture refuses non-development execution.');
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const voiceConfig = {
  protocolVersion: 1 as const,
  enabledModes: { dictation: false, live: false },
  supportedLocales: ['en-US'] as ['en-US'],
  limits: { ...DEFAULT_VOICE_LIMITS },
  inputAudio: { ...INPUT_AUDIO },
  outputAudio: { ...OUTPUT_AUDIO },
};

type CheckResult = { name: string; ok: boolean; error?: string };
const unexpected: string[] = [];
const adminRequests: Array<{ method: string; path: string; body: unknown }> = [];
const confirms: boolean[] = [];
let currentAdmin = publicConfig();
let mediaRequests = 0;
let streamCancelCount = 0;
let submitCount = 0;
let streamSignalAborted = false;
let refreshCount = 0;
let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
const encoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function pathname(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw;
  }
}

function envelope(sequence: number, event: object) {
  return {
    protocolVersion: STREAM_PROTOCOL_VERSION,
    sessionId: 'sess-1',
    turnId: 'turn-1',
    attemptId: 'att-1',
    sequence,
    event,
  };
}

function pushSse(event: object, sequence: number) {
  streamController?.enqueue(encoder.encode(`data: ${JSON.stringify(envelope(sequence, event))}\n\n`));
}

window.confirm = (message?: string) => {
  check(!String(message ?? '').toLowerCase().includes('fixture-only-key'), 'confirm contained a candidate');
  return confirms.shift() ?? false;
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = pathname(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
  if (path === '/api/sessions' && method === 'GET') {
    return json({ items: currentAdmin.revision > 0 ? [] : [], nextCursor: null });
  }
  if (path === '/api/sessions/sess-1' && method === 'GET') {
    return json({
      sessionId: 'sess-1', title: 'stream while away', pinned: false,
      createdAt: '2026-10-13T00:00:00.000Z', lastActivityAt: '2026-10-13T00:00:00.000Z',
    });
  }
  if (path === '/api/sessions/sess-1/messages' && method === 'GET') {
    return json({ items: [], nextCursor: null, olderAvailable: false });
  }
  if (path === '/api/sessions' && method === 'POST') {
    submitCount += 1;
    return json({
      sessionId: 'sess-1', turnId: 'turn-1', attemptId: 'att-1', userMessageId: 'msg-user-1',
      streamPath: '/sessions/sess-1/turns/turn-1/stream',
    });
  }
  if (path === '/api/sessions/sess-1/turns/turn-1/stream' && method === 'GET') {
    streamSignalAborted = Boolean(init?.signal?.aborted);
    init?.signal?.addEventListener('abort', () => { streamSignalAborted = true; });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
      cancel() { streamCancelCount += 1; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (path === '/api/voice/config' && method === 'GET') return json(voiceConfig);
  if (path === '/api/admin/config' && method === 'GET') return json(currentAdmin);
  if (path === '/api/admin/config' && method === 'PUT') {
    adminRequests.push({ method, path, body });
    currentAdmin = publicConfig(currentAdmin.revision + 1);
    currentAdmin.settings = (body as { settings: typeof currentAdmin.settings }).settings;
    return json(currentAdmin);
  }
  if (path.startsWith('/api/admin/config/credentials/') && method === 'POST') {
    adminRequests.push({ method, path, body });
    currentAdmin = publicConfig(currentAdmin.revision + 1);
    const provider = path.endsWith('openrouter') ? 'openrouter' : 'deepgram';
    const action = (body as { action?: string }).action;
    currentAdmin.credentials[provider] = action === 'remove'
      ? { configured: false, validatedAt: null }
      : { configured: true, validatedAt: '2026-10-13T01:00:00.000Z' };
    return json(currentAdmin);
  }
  unexpected.push(`${method} ${path}`);
  throw new Error(`Unexpected fixture request: ${method} ${path}`);
};

const mediaDevices = new EventTarget() as EventTarget & {
  getUserMedia: () => Promise<MediaStream>;
};
mediaDevices.getUserMedia = async () => {
  mediaRequests += 1;
  throw new Error('Fixture denied microphone access');
};
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: mediaDevices,
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openManage(root: HTMLElement) {
  const profile = [...root.querySelectorAll('summary')].find((node) => node.textContent?.includes('Super admin'));
  check(profile, 'Super admin profile is missing');
  await act(() => { profile.click(); });
  const manage = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Manage Aurvin');
  check(manage, 'Manage Aurvin is missing');
  await act(() => { manage.click(); });
  await flush();
}

async function backToChat(root: HTMLElement) {
  const back = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Back to chat');
  check(back, 'Back to chat is missing');
  await act(() => { back.click(); });
  await flush();
}

async function checkDraftSurvivesManageAurvin(root: HTMLElement) {
  const input = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
  check(input, 'Message input is missing');
  await act(() => { typeInput(input, 'keep this draft'); });
  await openManage(root);
  await backToChat(root);
  check(root.contains(input), 'Message input node was replaced');
  check(input.value === 'keep this draft', 'Draft was not preserved');
  check(mediaRequests === 0, 'Navigation requested media');
}

async function checkProfileFooter(root: HTMLElement) {
  const nav = root.querySelector('.aurvin-session-nav');
  const footer = root.querySelector('.aurvin-profile-footer');
  check(nav && footer, 'History or profile footer missing');
  check(nav.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING, 'Footer is not below history');
}

async function checkDisabledSignOut(root: HTMLElement) {
  const profile = [...root.querySelectorAll('summary')].find((node) => node.textContent?.includes('Super admin'));
  check(profile, 'Super admin profile is missing');
  await act(() => { profile.click(); });
  const signOut = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Sign out');
  check(signOut instanceof HTMLButtonElement && signOut.disabled, 'Sign out is not disabled');
  check(root.textContent?.includes('Authentication not enabled.'), 'Sign out explanation missing');
  press(profile, 'Escape');
}

async function checkConfigDefaultAndEmptyAnalytics(root: HTMLElement) {
  await openManage(root);
  const configTab = root.querySelector('[role="tab"][aria-selected="true"]');
  check(configTab?.textContent === 'Config', 'Config is not the default tab');
  const plugins = [...root.querySelectorAll('[role="tab"]')].find((node) => node.textContent === 'Plugins');
  check(plugins, 'Plugins tab missing');
  const settingsRail = root.querySelector('[aria-label="Settings sections"]');
  check(settingsRail && !settingsRail.textContent?.includes('Google Calendar'), 'Google Calendar still in Config rail');
  const analytics = [...root.querySelectorAll('[role="tab"]')].find((node) => node.textContent === 'Analytics');
  check(analytics, 'Analytics tab missing');
  await act(() => { analytics.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const panel = root.querySelector('[role="tabpanel"]:not([hidden])');
  check(panel, 'Analytics panel missing');
  check((panel.textContent ?? '').trim() === '', 'Analytics panel is not empty');
  check(!adminRequests.some((item) => item.path.includes('analytics')), 'Analytics request escaped');
  const config = [...root.querySelectorAll('[role="tab"]')].find((node) => node.textContent === 'Config');
  await act(() => { config?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

async function checkSectionAndSave(root: HTMLElement) {
  const model = root.querySelector<HTMLInputElement>('#admin-field-openRouter-modelId');
  check(model, 'Model ID is missing');
  await act(() => { typeInput(model, 'openai/gpt-4.1'); });
  const save = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Save changes');
  check(save instanceof HTMLButtonElement && !save.disabled, 'Save changes should be enabled');
  await act(() => { save.click(); save.click(); });
  await flush();
  check(root.textContent?.includes('Saved and active for new work'), 'Saved active status missing');
  check(refreshCount === 1, `refreshCapabilities ran ${refreshCount} times`);
}

async function checkCredentialReplace(root: HTMLElement) {
  const replace = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Replace key');
  check(replace, 'Replace key missing');
  await act(() => { replace.click(); });
  const input = root.querySelector<HTMLInputElement>('input[type="password"]');
  check(input, 'Password editor missing');
  check(!root.textContent?.includes('Reveal'), 'Reveal control present');
  await act(() => { typeInput(input, 'fixture-only-key'); });
  const validate = [...root.querySelectorAll('button')].find((node) => node.textContent === 'Validate and save');
  check(validate, 'Validate and save missing');
  const before = adminRequests.length;
  await act(() => { validate.click(); });
  await flush();
  const posts = adminRequests.filter((item) => item.method === 'POST' && item.path.includes('openrouter'));
  const posted = posts[0];
  check(posts.length === 1 && posted, 'Credential POST was not exactly once');
  check(!JSON.stringify(posted.body).includes('maxInputChars'), 'Credential POST included unrelated settings');
  check((posted.body as { candidate?: string }).candidate === 'fixture-only-key', 'Candidate was not posted');
  check(!root.querySelector('input[type="password"]'), 'Editor was not closed');
  check(adminRequests.length === before + 1, 'Extra admin request during replace');
  check(!root.textContent?.includes('fixture-only-key'), 'Candidate leaked into rendered text');
}

async function checkNoStorageCandidate() {
  check(!window.localStorage.getItem('fixture-only-key'), 'localStorage wrote a candidate');
  check(!document.cookie.includes('fixture-only-key'), 'cookie contained a candidate');
}

async function checkContinuity(root: HTMLElement) {
  await backToChat(root);
  const input = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
  check(input, 'Composer missing after return');
  await act(() => { typeInput(input, 'stream while away'); });
  const send = root.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
  check(send, 'Send missing');
  await act(() => { send.click(); });
  await flush();
  await openManage(root);
  await act(() => {
    pushSse({ type: 'turn-accepted', userMessageId: 'msg-user-1' }, 0);
    pushSse({ type: 'delta', text: 'hello' }, 1);
    pushSse({ type: 'status', status: 'completed', truncated: false }, 2);
    pushSse({ type: 'completed', assistantMessageId: 'msg-assistant-1', outcome: 'completed' }, 3);
    streamController?.close();
  });
  await flush();
  await backToChat(root);
  check(submitCount === 1, 'Submit was repeated');
  check(streamCancelCount === 0, 'Stream was cancelled by navigation');
  check(!streamSignalAborted, 'Stream signal aborted during admin navigation');
  check(root.textContent?.includes('hello'), 'Completed transcript missing');
}

async function checkPassiveVoice(root: HTMLElement) {
  const before = mediaRequests;
  await openManage(root);
  await backToChat(root);
  await openManage(root);
  await backToChat(root);
  check(mediaRequests === before, 'Repeated navigation requested media');
}

async function measureLayout() {
  check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'Horizontal overflow');
}

async function run(): Promise<void> {
  const status = document.getElementById('fixture-status');
  const list = document.getElementById('fixture-checks');
  const mount = document.getElementById('root');
  check(status && list && mount, 'Fixture regions are missing');
  const storageWrites: string[] = [];
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patched(key: string, value: string) {
    storageWrites.push(`${key}=${value}`);
    return setItem.call(this, key, value);
  };
  const { default: App } = await import('../../../App.tsx');
  const { createApiClient } = await import('../../../api/client.ts');
  const { createAdminConfigClient } = await import('../../../api/admin-config-client.ts');
  const client = createApiClient({ fetch: window.fetch });
  const adminClient = createAdminConfigClient({ fetch: window.fetch });
  const reactRoot = createRoot(mount);
  await act(() => {
    reactRoot.render(
      <App
        client={client}
        adminClient={adminClient}
        refreshCapabilities={async () => {
          refreshCount += 1;
          return true;
        }}
      />,
    );
  });
  await flush();
  const checks: Array<[string, (root: HTMLElement) => Promise<void>]> = [
    ['draft and selection survive Manage Aurvin', checkDraftSurvivesManageAurvin],
    ['profile footer stays below history', checkProfileFooter],
    ['disabled Sign out has no logout', checkDisabledSignOut],
    ['Config default and empty Analytics', checkConfigDefaultAndEmptyAnalytics],
    ['section fields and settings save', checkSectionAndSave],
    ['replace key posts once without unrelated fields', checkCredentialReplace],
    ['no candidate in storage', async () => checkNoStorageCandidate()],
    ['text continuity while admin is visible', checkContinuity],
    ['passive voice navigation does not request media', checkPassiveVoice],
    ['no horizontal overflow', async () => measureLayout()],
  ];
  const results: CheckResult[] = [];
  for (const [name, runCheck] of checks) {
    try {
      await runCheck(mount);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : 'failed' });
    }
  }
  Storage.prototype.setItem = setItem;
  const failed = results.filter((result) => !result.ok);
  list.replaceChildren(...results.map((result) => {
    const item = document.createElement('li');
    item.textContent = `${result.ok ? 'pass' : 'fail'}: ${result.name}${result.error ? ` (${result.error})` : ''}`;
    return item;
  }));
  status.textContent = `${results.filter((result) => result.ok).length}/${results.length} passed`;
  if (failed.length) status.textContent += `; first failure: ${failed[0].error}`;
  if (unexpected.length) status.textContent += `; unexpected: ${unexpected.join(', ')}`;
  if (storageWrites.some((item) => item.includes('fixture-only-key'))) {
    status.textContent += '; storage wrote a candidate';
  }
  void originalFetch;
  void byLabel;
}

void run().catch((error) => {
  const status = document.getElementById('fixture-status');
  if (status) status.textContent = `Fixture crashed: ${error instanceof Error ? error.message : 'unknown'}`;
});
