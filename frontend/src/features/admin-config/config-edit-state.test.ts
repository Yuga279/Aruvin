/**
 * ============================================================================
 * FILE: config-edit-state.test.ts
 * LOCATION: frontend/src/features/admin-config/config-edit-state.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Field catalog, draft conversion, and revision-fence reducer tests.
 *
 * ROLE IN PROJECT:
 *    Locks lossless nonsecret drafts, dirty overlay after credential saves,
 *    and lower-revision snapshot rejection without credential candidates.
 *
 * KEY COMPONENTS:
 *    - createEditState / editReducer / isDirty
 *    - fieldsFromSettings / settingsFromFields catalog round trips
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { ADMIN_CONFIG_ERROR_CODES, ADMIN_CONFIG_FIELD_PATHS, isManageableSettings } from '../../api/admin-config-protocol.ts';
import {
  ADMIN_ERROR_COPY,
  catalogCoverage,
  createEditState,
  editableFields,
  editReducer,
  errorCopy,
  fieldsFromSettings,
  isDirty,
  navigationDecision,
  settingsFromFields,
} from './config-edit-state.ts';
import { publicConfig } from './testing/fixtures.ts';

it('accepts the redacted public fixture', () => {
  expect(isManageableSettings(publicConfig().settings)).toBe(true);
});

it('covers every manageable field except request and candidate paths', () => {
  const managed = ADMIN_CONFIG_FIELD_PATHS.filter((path) => path !== 'candidate' && path !== 'expectedRevision');
  expect([...catalogCoverage].sort()).toEqual([...managed].sort());
});

it('advances credential revision without saving or discarding dirty fields', () => {
  let state = createEditState(publicConfig());
  state = editReducer(state, { type: 'edit', path: 'openRouter.modelId', value: 'new/model' });
  state = editReducer(state, { type: 'credentialSaved', config: publicConfig(2) });
  expect(state.baseline.revision).toBe(2);
  expect(state.fields['openRouter.modelId']).toBe('new/model');
  expect(state.baseline.settings.openRouter.modelId).toBe('openai/gpt-4.1-mini');
  expect(isDirty(state)).toBe(true);
  expect(JSON.stringify(state)).not.toContain('candidate');
});

it('treats reverted edits as clean', () => {
  let state = createEditState(publicConfig());
  state = editReducer(state, { type: 'edit', path: 'chat.titleMaxChars', value: '40' });
  expect(isDirty(state)).toBe(true);
  state = editReducer(state, { type: 'edit', path: 'chat.titleMaxChars', value: '80' });
  expect(isDirty(state)).toBe(false);
});

it('keeps blank required numbers invalid and allows blank nullable or known-zero rates', () => {
  const baseline = publicConfig().settings;
  const fields = fieldsFromSettings(baseline);
  expect(settingsFromFields(baseline, { ...fields, 'chat.maxInputChars': '' }).settings).toBeNull();
  expect(settingsFromFields(baseline, { ...fields, 'chat.maxInputChars': '' }).fieldErrors)
    .toContainEqual({ path: 'chat.maxInputChars', code: 'required' });
  expect(settingsFromFields(baseline, { ...fields, 'voice.dictationWarningMs': '' }).settings?.voice.dictationWarningMs)
    .toBeNull();
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.rates.novaPerMinuteUsd': '' })
    .settings?.deepgram.rates.novaPerMinuteUsd).toBeNull();
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.rates.novaPerMinuteUsd': '0' })
    .settings?.deepgram.rates.novaPerMinuteUsd).toBe(0);
  expect(settingsFromFields(baseline, { ...fields, 'voice.quotas.dailySpendUsd': '0' }).settings).toBeNull();
});

it('round-trips every catalog leaf from the fixture', () => {
  const baseline = publicConfig().settings;
  const result = settingsFromFields(baseline, fieldsFromSettings(baseline));
  expect(result.fieldErrors).toEqual([]);
  expect(result.settings).toEqual(baseline);
});

it('accepts only documented select allowlists', () => {
  const baseline = publicConfig().settings;
  const fields = fieldsFromSettings(baseline);
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.region': 'eu' }).settings?.deepgram.region).toBe('eu');
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.ttsModel': 'flux-priya-en' })
    .settings?.deepgram.ttsModel).toBe('flux-priya-en');
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.region': 'ap' }).fieldErrors)
    .toContainEqual({ path: 'deepgram.region', code: 'unsupported' });
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.dictationModel': 'nova-2' }).settings).toBeNull();
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.liveModel': 'other' }).settings).toBeNull();
});

it('rejects fractional integers, oversized keyterms, and empty keyterm lines without dropping them', () => {
  const baseline = publicConfig().settings;
  const fields = fieldsFromSettings(baseline);
  expect(settingsFromFields(baseline, { ...fields, 'chat.maxInputTokens': '1.5' }).fieldErrors)
    .toContainEqual({ path: 'chat.maxInputTokens', code: 'invalid' });
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.keyterms': 'alpha\n\nbeta' }).settings).toBeNull();
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.keyterms': `${'a'.repeat(65)}` }).fieldErrors)
    .toContainEqual({ path: 'deepgram.keyterms', code: 'out_of_range' });
  const tooMany = Array.from({ length: 51 }, (_, index) => `term-${index}`).join('\n');
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.keyterms': tooMany }).settings).toBeNull();
  expect(settingsFromFields(baseline, { ...fields, 'deepgram.keyterms': 'alpha\nbeta' }).settings?.deepgram.keyterms)
    .toEqual(['alpha', 'beta']);
});

it('preserves fixed privacy policies while replacing catalog fields', () => {
  const baseline = publicConfig().settings;
  const fields = fieldsFromSettings(baseline);
  const result = settingsFromFields(baseline, { ...fields, 'openRouter.modelId': 'openai/gpt-4.1' });
  expect(result.settings?.openRouter).toEqual({
    modelId: 'openai/gpt-4.1', dataCollection: 'deny', disableTransforms: true,
  });
  expect(editableFields.some((field) => field.path === 'openRouter.dataCollection')).toBe(false);
});

it('annotates context, warning, retry, quota, and spend cross-field failures', () => {
  const baseline = publicConfig().settings;
  const fields = fieldsFromSettings(baseline);
  const context = settingsFromFields(baseline, {
    ...fields, 'chat.maxContextTokens': '10', 'chat.maxOutputTokens': '8', 'chat.modelMarginTokens': '8',
  });
  expect(context.settings).toBeNull();
  expect(context.fieldErrors.map((error) => error.path)).toEqual(expect.arrayContaining([
    'chat.maxContextTokens', 'chat.maxOutputTokens', 'chat.modelMarginTokens',
  ]));
  const warning = settingsFromFields(baseline, {
    ...fields, 'voice.dictationWarningMs': String(baseline.voice.limits.dictationMaxMs),
  });
  expect(warning.fieldErrors.map((error) => error.path)).toEqual(expect.arrayContaining([
    'voice.dictationWarningMs', 'voice.limits.dictationMaxMs',
  ]));
  const retry = settingsFromFields(baseline, {
    ...fields, 'chat.retryBaseDelayMs': '1000', 'chat.retryMaxDelayMs': '250',
  });
  expect(retry.fieldErrors.map((error) => error.path)).toEqual(expect.arrayContaining([
    'chat.retryBaseDelayMs', 'chat.retryMaxDelayMs',
  ]));
  const quota = settingsFromFields(baseline, {
    ...fields, 'voice.quotas.identityConcurrent': '5', 'voice.quotas.globalConcurrent': '2',
  });
  expect(quota.fieldErrors.map((error) => error.path)).toEqual(expect.arrayContaining([
    'voice.quotas.identityConcurrent', 'voice.quotas.globalConcurrent',
  ]));
  const spend = settingsFromFields(baseline, { ...fields, 'voice.quotas.dailySpendUsd': '12.5' });
  expect(spend.fieldErrors.map((error) => error.path)).toEqual(expect.arrayContaining([
    'voice.quotas.dailySpendUsd', 'deepgram.rates.novaPerMinuteUsd',
  ]));
});

it('replaces drafts after a successful settings save', () => {
  let state = createEditState(publicConfig());
  state = editReducer(state, { type: 'edit', path: 'openRouter.modelId', value: 'saved/model' });
  state = editReducer(state, { type: 'begin', scope: 'settings' });
  const saved = publicConfig(2);
  saved.settings.openRouter.modelId = 'saved/model';
  state = editReducer(state, { type: 'settingsSaved', config: saved });
  expect(state.baseline.revision).toBe(2);
  expect(state.fields['openRouter.modelId']).toBe('saved/model');
  expect(state.pending).toBeNull();
  expect(isDirty(state)).toBe(false);
});

it('preserves fields and revision after a failed credential mutation', () => {
  let state = createEditState(publicConfig());
  state = editReducer(state, { type: 'edit', path: 'chat.titleMaxChars', value: '40' });
  state = editReducer(state, { type: 'begin', scope: 'openrouter' });
  state = editReducer(state, {
    type: 'failed',
    error: { code: 'CREDENTIAL_REJECTED', currentRevision: 9, fieldErrors: [] },
  });
  expect(state.baseline.revision).toBe(1);
  expect(state.fields['chat.titleMaxChars']).toBe('40');
  expect(state.stale).toBe(false);
  expect(state.pending).toBeNull();
  expect(state.error?.currentRevision).toBe(9);
});

it('locks mutations on conflict without using currentRevision as expectedRevision', () => {
  let state = createEditState(publicConfig());
  state = editReducer(state, { type: 'edit', path: 'openRouter.modelId', value: 'kept/model' });
  state = editReducer(state, {
    type: 'failed',
    error: { code: 'CONFIG_CONFLICT', currentRevision: 4, fieldErrors: [] },
  });
  expect(state.stale).toBe(true);
  expect(state.baseline.revision).toBe(1);
  expect(state.fields['openRouter.modelId']).toBe('kept/model');
  expect(editReducer(state, { type: 'begin', scope: 'settings' }).pending).toBeNull();
});

it('rejects older load and save snapshots after a newer baseline', () => {
  let state = createEditState(publicConfig(3));
  state = editReducer(state, { type: 'edit', path: 'openRouter.modelId', value: 'newer/model' });
  state = editReducer(state, { type: 'loaded', config: publicConfig(1) });
  state = editReducer(state, { type: 'settingsSaved', config: publicConfig(2) });
  state = editReducer(state, { type: 'credentialSaved', config: publicConfig(2) });
  expect(state.baseline.revision).toBe(3);
  expect(state.fields['openRouter.modelId']).toBe('newer/model');
});

it('does not undo a saved revision when capability refresh fails', () => {
  let state = createEditState(publicConfig(2));
  state = editReducer(state, { type: 'capabilities', ok: false });
  expect(state.baseline.revision).toBe(2);
  expect(state.capabilityWarning).toBe(true);
  state = editReducer(state, { type: 'capabilities', ok: true });
  expect(state.capabilityWarning).toBe(false);
});

it('covers every protocol error code with a safe message', () => {
  const missing = ADMIN_CONFIG_ERROR_CODES.filter((code) => !ADMIN_ERROR_COPY[code]);
  expect(missing).toEqual([]);
  expect(errorCopy('CONFIG_CONFLICT')).toContain('Settings changed elsewhere');
  expect(errorCopy('CONFIG_WRITE_UNCERTAIN')).toContain('unknown');
  expect(errorCopy('NETWORK_ERROR')).not.toContain('exception');
});

it('leaves only after an accepted discard when no save is pending', () => {
  expect(navigationDecision({ dirty: true, pending: false }, () => true)).toBe('leave');
  expect(navigationDecision({ dirty: false, pending: false }, () => true)).toBe('leave');
});

describe('uncertain failures', () => {
  it('locks further mutations until an explicit reload', () => {
    let state = createEditState(publicConfig());
    state = editReducer(state, {
      type: 'failed',
      error: { code: 'CONFIG_WRITE_UNCERTAIN', currentRevision: null, fieldErrors: [] },
    });
    expect(state.uncertain).toBe(true);
    expect(editReducer(state, { type: 'begin', scope: 'deepgram' }).pending).toBeNull();
    state = editReducer(state, { type: 'loaded', config: publicConfig(2) });
    expect(state.uncertain).toBe(false);
    expect(state.baseline.revision).toBe(2);
  });
});

it('accepts stored legacy idle timings without advertising automatic hang-up', () => {
  const baseline = publicConfig().settings;
  const fields = { ...fieldsFromSettings(baseline),
    'voice.limits.liveMaxMs': '30000', 'voice.limits.liveWarningMs': '20000' };
  expect(settingsFromFields(baseline, fields).fieldErrors).toEqual([]);
  expect(editableFields.find(f => f.path === 'voice.limits.idleExitAfterWarningMs')?.help)
    .toBe('Stored for compatibility only. Does not end or suspend a live call.');
});
