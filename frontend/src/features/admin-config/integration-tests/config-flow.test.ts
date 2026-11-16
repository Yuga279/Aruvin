import { expect, it, vi } from 'vitest';
import { createAdminConfigClient } from '../../../api/admin-config-client.ts';
import { createEditState, editReducer, isDirty } from '../config-edit-state.ts';
import { publicConfig } from '../testing/fixtures.ts';
import { adminFailure } from '../testing/fixtures.ts';

it('credential save advances revision without saving a dirty setting', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(publicConfig(2)));
  const client = createAdminConfigClient({ fetch: fetcher });
  let state = createEditState(publicConfig(1));
  state = editReducer(state, { type: 'edit', path: 'chat.titleMaxChars', value: '40' });
  const config = await client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1,
    action: 'replace', candidate: 'fixture-only-candidate',
  });
  state = editReducer(state, { type: 'credentialSaved', config });
  expect(state.baseline.revision).toBe(2);
  expect(state.fields['chat.titleMaxChars']).toBe('40');
  expect(isDirty(state)).toBe(true);
  expect(JSON.stringify(state)).not.toContain('fixture-only-candidate');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    protocolVersion: 1, expectedRevision: 1,
    action: 'replace', candidate: 'fixture-only-candidate',
  });
});

it('stale conflict retains edits and does not promote server revision', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(adminFailure('CONFIG_CONFLICT', 3), { status: 409 }));
  const client = createAdminConfigClient({ fetch: fetcher });
  let state = createEditState(publicConfig(1));
  state = editReducer(state, { type: 'edit', path: 'chat.titleMaxChars', value: '40' });
  await expect(client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-only-candidate',
  })).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  expect(state.fields['chat.titleMaxChars']).toBe('40');
  expect(state.baseline.revision).toBe(1);
});

it('removal requires confirmation object and makes one scoped request', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(publicConfig(2)));
  const client = createAdminConfigClient({ fetch: fetcher });
  await client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
  });
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body.action).toBe('remove');
  expect(body.confirm).toBe(true);
  expect(body).not.toHaveProperty('candidate');
  expect(body).not.toHaveProperty('settings');
});