/**
 * ============================================================================
 * FILE: voice-draft-lock.test.ts
 * LOCATION: frontend/src/features/chat/state/voice-draft-lock.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for atomic voice lease token, draft fencing, and submit interlock.
 *
 * ROLE IN PROJECT:
 *    Verifies that claiming voice input locks editing, prevents submit/retry,
 *    and isolates draft updates from stale callbacks or navigation events.
 *
 * KEY COMPONENTS:
 *    - Voice draft lock test suite
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import { useChatActions } from './use-chat.ts';
import { ChatProvider, useChat } from './chat-context.tsx';

it('rejects ordinary edits and stale transcript writes while preserving user chat behavior', () => {
  const initial = { ...initialChatState, draftInput: 'old', activeSessionId: 'chat-1' };
  const locked = chatReducer(initial, { type: 'CLAIM_VOICE_INPUT', payload: { token: 'one', mode: 'dictation' } });
  expect(chatReducer(locked, { type: 'SET_DRAFT', payload: 'typed' })).toBe(locked);
  expect(chatReducer(locked, { type: 'VOICE_DRAFT', payload: { token: 'wrong', text: 'bad' } })).toBe(locked);
  expect(chatReducer(locked, { type: 'TURN_SUBMIT_START', payload: { userContent: 'bad', idempotencyKey: 'key-1' } })).toBe(locked);
  const updated = chatReducer(locked, { type: 'VOICE_DRAFT', payload: { token: 'one', text: 'dictated' } });
  const navigated = chatReducer(updated, { type: 'NEW_CHAT' });
  expect(navigated.voiceInput).toBeNull();
  expect(navigated.draftInput).toBe('dictated');
  expect(chatReducer(navigated, { type: 'VOICE_DRAFT', payload: { token: 'one', text: 'late' } })).toBe(navigated);
});

it.each(['dictation', 'live'] as const)('blocks stale submit/retry/setDraft callbacks synchronously for %s', async mode => {
  let state: ChatState = { ...initialChatState, activeSessionId: 'chat-1', draftInput: 'original' };
  const fetcher = vi.fn(async () => new Response('', { status: 500 }));
  const client = new ApiClient({ fetch: fetcher });
  const dispatched: ChatAction[] = [];
  const dispatch = (action: ChatAction) => { dispatched.push(action); state = chatReducer(state, action); };
  let actions!: ReturnType<typeof useChatActions>;
  function Harness() { actions = useChatActions(state, dispatch, client); return null; }
  renderToStaticMarkup(createElement(Harness));
  const staleSubmit = actions.submitMessage;
  const token = actions.claimVoiceInput(mode, () => {});
  expect(token).not.toBeNull();
  expect(actions.claimVoiceInput(mode === 'dictation' ? 'live' : 'dictation', () => {})).toBeNull();
  await staleSubmit('unsent');
  await actions.retryTurn('turn-1');
  actions.setDraft('typed during capture');
  expect(fetcher).not.toHaveBeenCalled();
  expect(state.draftInput).toBe('original');
  expect(dispatched.filter(action => action.type === 'TURN_SUBMIT_START')).toEqual([]);
  expect(actions.writeVoiceDraft(token!, 'finalized')).toBe(true);
  actions.releaseVoiceInput('obsolete');
  expect(actions.isVoiceInputLocked()).toBe(true);
  actions.releaseVoiceInput(token!);
  expect(actions.isVoiceInputLocked()).toBe(false);
  expect(actions.writeVoiceDraft(token!, 'late')).toBe(false);
  expect(state.draftInput).toBe('finalized');
});

it('raw provider navigation dispatch closes capture before navigation, including same-null New Chat', () => {
  const fetcher = vi.fn(async () => new Response('', { status: 500 }));
  let context!: ReturnType<typeof useChat>;
  function Child() { context = useChat(); return null; }
  renderToStaticMarkup(createElement(ChatProvider,
    { client: new ApiClient({ fetch: fetcher }), children: createElement(Child) }));
  const close = vi.fn();
  context.actions.claimVoiceInput('dictation', close);
  context.dispatch({ type: 'NEW_CHAT' });
  expect(close).toHaveBeenCalledTimes(1);
  expect(context.actions.isVoiceInputLocked()).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it('binds conversation ID during active live voice and rejects invalid or conflicting bindings', () => {
  let state: ChatState = { ...initialChatState, draftInput: 'unsent text' };
  const client = new ApiClient({ fetch: vi.fn() });
  const dispatched: ChatAction[] = [];
  const dispatch = (action: ChatAction) => { dispatched.push(action); state = chatReducer(state, action); };
  let actions!: ReturnType<typeof useChatActions>;
  function Harness() { actions = useChatActions(state, dispatch, client); return null; }
  renderToStaticMarkup(createElement(Harness));

  // Cannot bind without active lease
  expect(actions.bindVoiceConversation('no-token', 'chat-1')).toBe(false);

  // Claim dictation lease: dictation cannot bind conversation
  const dictToken = actions.claimVoiceInput('dictation', () => {});
  expect(actions.bindVoiceConversation(dictToken!, 'chat-1')).toBe(false);
  actions.releaseVoiceInput(dictToken!);

  // Claim live lease
  const liveToken = actions.claimVoiceInput('live', () => {});
  expect(liveToken).not.toBeNull();

  // Wrong token fails
  expect(actions.bindVoiceConversation('wrong-token', 'chat-1')).toBe(false);

  // Valid live binding binds conversation ID to new chat
  expect(actions.bindVoiceConversation(liveToken!, 'chat-1')).toBe(true);
  expect(state.activeSessionId).toBe('chat-1');
  expect(state.activeSessionTitle).toBe('New chat');
  expect(state.draftInput).toBe('unsent text');

  // Re-binding the same conversation ID succeeds idempotently
  expect(actions.bindVoiceConversation(liveToken!, 'chat-1')).toBe(true);
  expect(state.activeSessionId).toBe('chat-1');

  // Binding a conflicting conversation ID fails closed
  expect(actions.bindVoiceConversation(liveToken!, 'different-chat')).toBe(false);
  expect(state.activeSessionId).toBe('chat-1');

  // After release, binding fails
  actions.releaseVoiceInput(liveToken!);
  expect(actions.bindVoiceConversation(liveToken!, 'chat-1')).toBe(false);
});

it('chatReducer BIND_VOICE_CONVERSATION guards token, mode, and session conflict', () => {
  const initial = { ...initialChatState, activeSessionId: null, voiceInput: { token: 't1', mode: 'live' as const } };
  const bound = chatReducer(initial, { type: 'BIND_VOICE_CONVERSATION', payload: { token: 't1', conversationId: 'c1' } });
  expect(bound.activeSessionId).toBe('c1');
  expect(bound.activeSessionTitle).toBe('New chat');

  // Stale token ignored
  expect(chatReducer(bound, { type: 'BIND_VOICE_CONVERSATION', payload: { token: 'wrong', conversationId: 'c2' } })).toBe(bound);

  // Dictation mode ignored
  const dictState = { ...initialChatState, voiceInput: { token: 't2', mode: 'dictation' as const } };
  expect(chatReducer(dictState, { type: 'BIND_VOICE_CONVERSATION', payload: { token: 't2', conversationId: 'c1' } })).toBe(dictState);

  // Conflicting session ignored
  expect(chatReducer(bound, { type: 'BIND_VOICE_CONVERSATION', payload: { token: 't1', conversationId: 'c2' } })).toBe(bound);

  // Existing session title preserved when binding matches existing session
  const existingWithTitle = { ...bound, activeSessionTitle: 'Custom Title' };
  const rebind = chatReducer(existingWithTitle, { type: 'BIND_VOICE_CONVERSATION', payload: { token: 't1', conversationId: 'c1' } });
  expect(rebind.activeSessionTitle).toBe('Custom Title');
});

