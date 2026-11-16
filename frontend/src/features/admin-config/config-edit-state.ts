/**
 * ============================================================================
 * FILE: config-edit-state.ts
 * LOCATION: frontend/src/features/admin-config/config-edit-state.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Field catalog, raw draft conversion, and redacted admin edit reducer.
 *
 * ROLE IN PROJECT:
 *    Holds nonsecret dashboard drafts, dirty/CAS rules, and navigation
 *    decisions without storing credential candidates.
 *
 * KEY COMPONENTS:
 *    - editableFields: Explicit labeled catalog of manageable leaves.
 *    - editReducer: Revision-fenced baseline/draft transitions.
 * ============================================================================
 */

import {
  ADMIN_CONFIG_ERROR_CODES,
  isManageableSettings,
  type AdminConfigError,
  type AdminConfigErrorCode,
  type AdminConfigFieldPath,
  type CredentialProvider,
  type ManageableSettings,
  type PublicAdminConfig,
} from '../../api/admin-config-protocol.ts';

export type AdminSection = 'openrouter' | 'chat' | 'voice' | 'deepgram';
export type AdminTab = 'config' | 'plugins' | 'analytics' | 'administration';
export type MutationScope = 'settings' | CredentialProvider;
export type FieldValues = Partial<Record<AdminConfigFieldPath, string | boolean>>;
export type FieldKind =
  | 'text' | 'integer' | 'decimal' | 'nullable-integer' | 'nullable-decimal'
  | 'boolean' | 'select' | 'keyterms';
export type FieldError = AdminConfigError['error']['fieldErrors'][number];

export type EditableField = {
  path: AdminConfigFieldPath;
  section: AdminSection;
  group: string;
  label: string;
  help: string;
  kind: FieldKind;
  unit?: string;
  choices?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
};

const TIMER_MAX = 2_147_483_647;
const SAFE_MAX = Number.MAX_SAFE_INTEGER;
const FIXED_POLICY_PATHS = ['openRouter.dataCollection', 'openRouter.disableTransforms'] as const;

export const editableFields: readonly EditableField[] = [
  { path: 'openRouter.modelId', section: 'openrouter', group: 'OpenRouter',
    label: 'Model ID', help: 'The server verifies model limits for this identifier.',
    kind: 'text', max: 200 },
  { path: 'chat.maxInputChars', section: 'chat', group: 'Input and context',
    label: 'Input characters', help: 'Maximum characters accepted in one message.',
    kind: 'integer', min: 1, max: 32_000 },
  { path: 'chat.maxInputTokens', section: 'chat', group: 'Input and context',
    label: 'Input tokens', help: 'Maximum tokens accepted from one message.',
    kind: 'integer', min: 1, max: SAFE_MAX, unit: 'tokens' },
  { path: 'chat.maxMessagesInContext', section: 'chat', group: 'Input and context',
    label: 'Messages in context', help: 'How many prior messages may be selected.',
    kind: 'integer', min: 1, max: 500 },
  { path: 'chat.maxContextTokens', section: 'chat', group: 'Input and context',
    label: 'Context tokens', help: 'Must stay above output tokens plus the safety margin.',
    kind: 'integer', min: 1, max: SAFE_MAX, unit: 'tokens' },
  { path: 'chat.maxOutputTokens', section: 'chat', group: 'Input and context',
    label: 'Output tokens', help: 'Maximum tokens the model may generate.',
    kind: 'integer', min: 1, max: SAFE_MAX, unit: 'tokens' },
  { path: 'chat.modelMarginTokens', section: 'chat', group: 'Input and context',
    label: 'Model safety margin', help: 'Reserved tokens kept out of the context budget.',
    kind: 'integer', min: 1, max: SAFE_MAX, unit: 'tokens' },
  { path: 'chat.titleMaxChars', section: 'chat', group: 'Input and context',
    label: 'Chat title characters', help: 'Maximum stored chat title length.',
    kind: 'integer', min: 1, max: 80 },
  { path: 'chat.maxConcurrentGenerationsPerProcess', section: 'chat', group: 'Admission and retries',
    label: 'Concurrent responses',
    help: 'Process-wide generation ceiling. One active attempt per chat is fixed and cannot be changed here.',
    kind: 'integer', min: 1, max: SAFE_MAX },
  { path: 'chat.maxRequestsPerMinutePerUser', section: 'chat', group: 'Admission and retries',
    label: 'Requests per minute per user', help: 'Per-user request admission rate.',
    kind: 'integer', min: 1, max: SAFE_MAX },
  { path: 'chat.retryMaxAttempts', section: 'chat', group: 'Admission and retries',
    label: 'Maximum attempts', help: 'Includes the first attempt. Range 1–3.',
    kind: 'integer', min: 1, max: 3 },
  { path: 'chat.retryBaseDelayMs', section: 'chat', group: 'Admission and retries',
    label: 'Initial retry delay', help: 'Displayed in milliseconds to avoid rounding.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'chat.retryMaxDelayMs', section: 'chat', group: 'Admission and retries',
    label: 'Maximum retry delay', help: 'Must be at least the initial delay and within the total timeout.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'chat.firstOutputTimeoutMs', section: 'chat', group: 'Deadlines',
    label: 'First output timeout', help: 'Must not exceed the total response timeout.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'chat.idleStreamTimeoutMs', section: 'chat', group: 'Deadlines',
    label: 'Stream idle timeout', help: 'Must not exceed the total response timeout.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'chat.totalRunTimeoutMs', section: 'chat', group: 'Deadlines',
    label: 'Total response timeout', help: 'Ceiling for a single response, in milliseconds.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.enabledModes.dictation', section: 'voice', group: 'Modes and duration',
    label: 'Dictation enabled',
    help: 'Applies to new sessions only. Disabling does not cancel an active session.',
    kind: 'boolean' },
  { path: 'voice.enabledModes.live', section: 'voice', group: 'Modes and duration',
    label: 'Live voice enabled',
    help: 'Applies to new sessions only. Disabling does not cancel an active session.',
    kind: 'boolean' },
  { path: 'voice.limits.dictationMaxMs', section: 'voice', group: 'Modes and duration',
    label: 'Dictation duration', help: 'Maximum dictation length in milliseconds.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.dictationWarningMs', section: 'voice', group: 'Modes and duration',
    label: 'Dictation warning', help: 'No warning. Blank leaves dictation without a warning time.',
    kind: 'nullable-integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.liveMaxMs', section: 'voice', group: 'Modes and duration',
    label: 'Live voice duration', help: 'Maximum live session length in milliseconds.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.liveWarningMs', section: 'voice', group: 'Modes and duration',
    label: 'Live warning', help: 'Must be shorter than the live duration.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.idleWarningMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Idle notice', help: 'Milliseconds before an informational idle notice. Does not end the call.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.idleExitAfterWarningMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Legacy idle exit delay', help: 'Stored for compatibility only. Does not end or suspend a live call.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.finalizationMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Finalization timeout', help: 'Must not exceed dictation duration.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.reconnectMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Reconnect timeout', help: 'Milliseconds allowed to reconnect a live session.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.connectMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Voice connection timeout',
    help: 'Voice session connect timeout, distinct from the fixed shared infrastructure connection ceiling.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.inputQueueMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Input audio queue', help: 'Must not exceed dictation duration.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.limits.outputQueueMs', section: 'voice', group: 'Advanced timing and queues',
    label: 'Output audio queue', help: 'Must not exceed live voice duration.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'voice.quotas.identityConcurrent', section: 'voice', group: 'Quotas',
    label: 'Concurrent sessions per user',
    help: 'Edits do not reset usage. Lowering caps does not terminate already admitted work.',
    kind: 'integer', min: 1, max: SAFE_MAX },
  { path: 'voice.quotas.globalConcurrent', section: 'voice', group: 'Quotas',
    label: 'Concurrent sessions overall',
    help: 'Edits do not reset usage. Lowering caps does not terminate already admitted work.',
    kind: 'integer', min: 1, max: SAFE_MAX },
  { path: 'voice.quotas.identityDailyMinutes', section: 'voice', group: 'Quotas',
    label: 'Daily minutes per user',
    help: 'Edits do not reset usage. Lowering caps does not terminate already admitted work.',
    kind: 'integer', min: 1, max: SAFE_MAX, unit: 'min' },
  { path: 'voice.quotas.globalDailyMinutes', section: 'voice', group: 'Quotas',
    label: 'Daily minutes overall',
    help: 'Edits do not reset usage. Lowering caps does not terminate already admitted work.',
    kind: 'integer', min: 1, max: SAFE_MAX, unit: 'min' },
  { path: 'voice.quotas.dailySpendUsd', section: 'voice', group: 'Quotas',
    label: 'Daily spend cap', help: 'No spend cap. All three Deepgram rates are required when a cap is set.',
    kind: 'nullable-decimal', min: 0, step: 0.01, unit: 'USD' },
  { path: 'deepgram.region', section: 'deepgram', group: 'Models',
    label: 'Region', help: 'Supported Deepgram API region.',
    kind: 'select', choices: ['us', 'eu'] },
  { path: 'deepgram.dictationModel', section: 'deepgram', group: 'Models',
    label: 'Dictation model', help: 'Fixed supported Nova 3 dictation model.',
    kind: 'select', choices: ['nova-3'] },
  { path: 'deepgram.liveModel', section: 'deepgram', group: 'Models',
    label: 'Live model', help: 'Fixed supported Flux general English model.',
    kind: 'select', choices: ['flux-general-en'] },
  { path: 'deepgram.ttsModel', section: 'deepgram', group: 'Models',
    label: 'Speech model', help: 'Choose a supported Flux voice.',
    kind: 'select', choices: ['flux-haley-en', 'flux-alexis-en', 'flux-priya-en'] },
  { path: 'deepgram.endpointingMs', section: 'deepgram', group: 'Speech',
    label: 'Endpointing', help: 'Range 300–500 milliseconds.',
    kind: 'integer', min: 300, max: 500, unit: 'ms' },
  { path: 'deepgram.spokenPunctuation', section: 'deepgram', group: 'Speech',
    label: 'Spoken punctuation', help: 'Ask the provider to speak punctuation.',
    kind: 'boolean' },
  { path: 'deepgram.keyterms', section: 'deepgram', group: 'Speech',
    label: 'Keyterms', help: 'One term per line, at most 50 terms, 64 characters each. Entries are not dropped to pass validation.',
    kind: 'keyterms' },
  { path: 'deepgram.eotThreshold', section: 'deepgram', group: 'Speech',
    label: 'End-of-turn threshold', help: 'Range 0.5–1.',
    kind: 'decimal', min: 0.5, max: 1, step: 0.01 },
  { path: 'deepgram.eotTimeoutMs', section: 'deepgram', group: 'Speech',
    label: 'End-of-turn timeout', help: 'Milliseconds to wait for end of turn.',
    kind: 'integer', min: 1, max: TIMER_MAX, unit: 'ms' },
  { path: 'deepgram.rates.novaPerMinuteUsd', section: 'deepgram', group: 'Rates',
    label: 'Dictation USD/minute', help: 'Unknown rate. Empty is unknown, not free. Zero is a known rate.',
    kind: 'nullable-decimal', min: 0, step: 0.0001, unit: 'USD' },
  { path: 'deepgram.rates.fluxSttPerMinuteUsd', section: 'deepgram', group: 'Rates',
    label: 'Live transcription USD/minute', help: 'Unknown rate. Empty is unknown, not free. Zero is a known rate.',
    kind: 'nullable-decimal', min: 0, step: 0.0001, unit: 'USD' },
  { path: 'deepgram.rates.fluxTtsPerThousandCharsUsd', section: 'deepgram', group: 'Rates',
    label: 'Speech USD/1000 characters', help: 'Unknown rate. Empty is unknown, not free. Zero is a known rate.',
    kind: 'nullable-decimal', min: 0, step: 0.0001, unit: 'USD' },
];

export const catalogPaths = editableFields.map((field) => field.path);

export type EditFailure = {
  code: string;
  currentRevision: number | null;
  fieldErrors: AdminConfigError['error']['fieldErrors'];
  uncertain?: boolean;
};

export type EditState = {
  baseline: PublicAdminConfig;
  fields: FieldValues;
  pending: MutationScope | null;
  error: EditFailure | null;
  capabilityWarning: boolean;
  stale: boolean;
  uncertain: boolean;
};

export type EditAction =
  | { type: 'edit'; path: AdminConfigFieldPath; value: string | boolean }
  | { type: 'begin'; scope: MutationScope }
  | { type: 'settingsSaved'; config: PublicAdminConfig }
  | { type: 'credentialSaved'; config: PublicAdminConfig }
  | { type: 'failed'; error: EditFailure }
  | { type: 'loaded'; config: PublicAdminConfig }
  | { type: 'capabilities'; ok: boolean };

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), source);
}

function writePath(target: ManageableSettings, path: string, value: unknown) {
  const parts = path.split('.');
  let current: Record<string, unknown> = target as unknown as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = current[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return;
    current = next as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function fieldError(path: AdminConfigFieldPath, code: FieldError['code']): FieldError {
  return { path, code };
}

function parseInteger(raw: string): number | undefined {
  if (raw === '' || raw.trim() !== raw || !/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function parseDecimal(raw: string): number | undefined {
  if (raw === '' || raw.trim() !== raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function convertField(
  field: EditableField,
  raw: string | boolean | undefined,
): { value?: unknown; error?: FieldError } {
  if (raw === undefined) return {};
  if (field.kind === 'boolean') {
    return typeof raw === 'boolean' ? { value: raw } : { error: fieldError(field.path, 'invalid') };
  }
  if (typeof raw !== 'string') return { error: fieldError(field.path, 'invalid') };
  if (field.kind === 'text') {
    if (raw.length > (field.max ?? 200) || raw.trim() !== raw) return { error: fieldError(field.path, 'invalid') };
    return { value: raw };
  }
  if (field.kind === 'select') {
    return field.choices?.includes(raw) ? { value: raw } : { error: fieldError(field.path, 'unsupported') };
  }
  if (field.kind === 'keyterms') {
    if (raw === '') return { value: [] };
    const terms = raw.split('\n').map((line) => line.trim());
    if (terms.some((term) => term.length === 0)) return { error: fieldError(field.path, 'invalid') };
    if (terms.length > 50 || terms.some((term) => term.length > 64)) {
      return { error: fieldError(field.path, 'out_of_range') };
    }
    return { value: terms };
  }
  if (field.kind === 'nullable-integer' || field.kind === 'nullable-decimal') {
    if (raw === '') return { value: null };
    const parsed = field.kind === 'nullable-integer' ? parseInteger(raw) : parseDecimal(raw);
    if (parsed === undefined) return { error: fieldError(field.path, 'invalid') };
    if (field.path === 'voice.quotas.dailySpendUsd' && !(parsed > 0)) {
      return { error: fieldError(field.path, 'out_of_range') };
    }
    if (field.min !== undefined && parsed < field.min) return { error: fieldError(field.path, 'out_of_range') };
    if (field.max !== undefined && parsed > field.max) return { error: fieldError(field.path, 'out_of_range') };
    return { value: parsed };
  }
  const parsed = field.kind === 'decimal' ? parseDecimal(raw) : parseInteger(raw);
  if (raw === '' || parsed === undefined) {
    return { error: fieldError(field.path, raw === '' ? 'required' : 'invalid') };
  }
  if (field.min !== undefined && parsed < field.min) return { error: fieldError(field.path, 'out_of_range') };
  if (field.max !== undefined && parsed > field.max) return { error: fieldError(field.path, 'out_of_range') };
  return { value: parsed };
}

function annotate(paths: AdminConfigFieldPath[]): FieldError[] {
  return paths.map((path) => fieldError(path, 'cross_field'));
}

function crossFieldErrors(settings: ManageableSettings): FieldError[] {
  const errors: FieldError[] = [];
  const chat = settings.chat;
  if (chat.maxContextTokens - chat.maxOutputTokens - chat.modelMarginTokens <= 0) {
    errors.push(...annotate(['chat.maxContextTokens', 'chat.maxOutputTokens', 'chat.modelMarginTokens']));
  }
  if (chat.retryMaxDelayMs < chat.retryBaseDelayMs) {
    errors.push(...annotate(['chat.retryBaseDelayMs', 'chat.retryMaxDelayMs']));
  }
  if (chat.retryMaxDelayMs > chat.totalRunTimeoutMs) {
    errors.push(...annotate(['chat.retryMaxDelayMs', 'chat.totalRunTimeoutMs']));
  }
  if (chat.firstOutputTimeoutMs > chat.totalRunTimeoutMs) {
    errors.push(...annotate(['chat.firstOutputTimeoutMs', 'chat.totalRunTimeoutMs']));
  }
  if (chat.idleStreamTimeoutMs > chat.totalRunTimeoutMs) {
    errors.push(...annotate(['chat.idleStreamTimeoutMs', 'chat.totalRunTimeoutMs']));
  }
  const voice = settings.voice;
  if (voice.dictationWarningMs !== null && voice.dictationWarningMs >= voice.limits.dictationMaxMs) {
    errors.push(...annotate(['voice.dictationWarningMs', 'voice.limits.dictationMaxMs']));
  }
  if (voice.limits.liveWarningMs >= voice.limits.liveMaxMs) {
    errors.push(...annotate(['voice.limits.liveWarningMs', 'voice.limits.liveMaxMs']));
  }
  if (voice.limits.finalizationMs > voice.limits.dictationMaxMs) {
    errors.push(...annotate(['voice.limits.finalizationMs', 'voice.limits.dictationMaxMs']));
  }
  if (voice.limits.inputQueueMs > voice.limits.dictationMaxMs) {
    errors.push(...annotate(['voice.limits.inputQueueMs', 'voice.limits.dictationMaxMs']));
  }
  if (voice.limits.outputQueueMs > voice.limits.liveMaxMs) {
    errors.push(...annotate(['voice.limits.outputQueueMs', 'voice.limits.liveMaxMs']));
  }
  if (voice.quotas.identityConcurrent > voice.quotas.globalConcurrent) {
    errors.push(...annotate(['voice.quotas.identityConcurrent', 'voice.quotas.globalConcurrent']));
  }
  if (voice.quotas.identityDailyMinutes > voice.quotas.globalDailyMinutes) {
    errors.push(...annotate(['voice.quotas.identityDailyMinutes', 'voice.quotas.globalDailyMinutes']));
  }
  if (voice.quotas.dailySpendUsd !== null && (
    settings.deepgram.rates.novaPerMinuteUsd === null
    || settings.deepgram.rates.fluxSttPerMinuteUsd === null
    || settings.deepgram.rates.fluxTtsPerThousandCharsUsd === null
  )) {
    errors.push(...annotate([
      'voice.quotas.dailySpendUsd',
      'deepgram.rates.novaPerMinuteUsd',
      'deepgram.rates.fluxSttPerMinuteUsd',
      'deepgram.rates.fluxTtsPerThousandCharsUsd',
    ]));
  }
  return errors;
}

export function fieldsFromSettings(settings: ManageableSettings): FieldValues {
  const fields: FieldValues = {};
  for (const field of editableFields) {
    const value = readPath(settings, field.path);
    if (field.kind === 'boolean') fields[field.path] = Boolean(value);
    else if (field.kind === 'keyterms') fields[field.path] = Array.isArray(value) ? value.join('\n') : '';
    else if (value === null || value === undefined) fields[field.path] = '';
    else fields[field.path] = String(value);
  }
  return fields;
}

export function settingsFromFields(
  baseline: ManageableSettings,
  fields: FieldValues,
): { settings: ManageableSettings | null; fieldErrors: FieldError[] } {
  const settings = structuredClone(baseline);
  const fieldErrors: FieldError[] = [];
  for (const field of editableFields) {
    const converted = convertField(field, fields[field.path]);
    if (converted.error) fieldErrors.push(converted.error);
    else if (converted.value !== undefined) writePath(settings, field.path, converted.value);
  }
  if (fieldErrors.length > 0) return { settings: null, fieldErrors };
  if (isManageableSettings(settings)) return { settings, fieldErrors: [] };
  const cross = crossFieldErrors(settings);
  return { settings: null, fieldErrors: cross.length > 0 ? cross : [fieldError('openRouter.modelId', 'invalid')] };
}

export function createEditState(config: PublicAdminConfig): EditState {
  return {
    baseline: structuredClone(config),
    fields: fieldsFromSettings(config.settings),
    pending: null,
    error: null,
    capabilityWarning: false,
    stale: false,
    uncertain: false,
  };
}

export function isDirty(state: EditState): boolean {
  const original = fieldsFromSettings(state.baseline.settings);
  return editableFields.some((field) => state.fields[field.path] !== original[field.path]);
}

function overlayDirty(state: EditState, config: PublicAdminConfig): FieldValues {
  const previous = fieldsFromSettings(state.baseline.settings);
  const next = fieldsFromSettings(config.settings);
  for (const field of editableFields) {
    const current = state.fields[field.path];
    if (current !== undefined && current !== previous[field.path]) next[field.path] = current;
  }
  return next;
}

function olderSnapshot(config: PublicAdminConfig, baseline: PublicAdminConfig): boolean {
  return config.revision < baseline.revision;
}

function isUncertainFailure(error: EditFailure): boolean {
  return error.uncertain === true
    || error.code === 'CONFIG_WRITE_UNCERTAIN'
    || error.code === 'NETWORK_ERROR'
    || error.code === 'ADMIN_REQUEST_TIMEOUT'
    || error.code === 'INVALID_ADMIN_RESPONSE';
}

export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'edit':
      if (!catalogPaths.includes(action.path)) return state;
      return { ...state, fields: { ...state.fields, [action.path]: action.value } };
    case 'begin':
      if (state.pending || state.stale || state.uncertain) return state;
      return { ...state, pending: action.scope, error: null };
    case 'loaded':
      if (olderSnapshot(action.config, state.baseline)) return state;
      return createEditState(action.config);
    case 'settingsSaved':
      if (olderSnapshot(action.config, state.baseline)) return { ...state, pending: null };
      return createEditState(action.config);
    case 'credentialSaved':
      if (olderSnapshot(action.config, state.baseline)) return { ...state, pending: null };
      return {
        ...state,
        baseline: structuredClone(action.config),
        fields: overlayDirty(state, action.config),
        pending: null,
        error: null,
        stale: false,
        uncertain: false,
      };
    case 'failed':
      return {
        ...state,
        pending: null,
        error: {
          code: action.error.code,
          currentRevision: action.error.currentRevision,
          fieldErrors: action.error.fieldErrors,
          uncertain: action.error.uncertain,
        },
        stale: state.stale || action.error.code === 'CONFIG_CONFLICT',
        uncertain: state.uncertain || isUncertainFailure(action.error),
      };
    case 'capabilities':
      return { ...state, capabilityWarning: !action.ok };
    default:
      return state;
  }
}

export function navigationDecision(
  { dirty, pending }: { dirty: boolean; pending: boolean },
  confirmDiscard: () => boolean,
): 'stay' | 'leave' {
  if (pending) return 'stay';
  if (dirty && !confirmDiscard()) return 'stay';
  return 'leave';
}

export const catalogCoverage = [...catalogPaths, ...FIXED_POLICY_PATHS];

export const ADMIN_ERROR_COPY: Record<AdminConfigErrorCode, string> = {
  INVALID_CONFIG_REQUEST: 'The configuration request is invalid. Review the highlighted fields.',
  CONFIG_VALIDATION_FAILED: 'Some fields could not be saved. Review the highlighted fields.',
  CONFIG_CONFLICT: 'Settings changed elsewhere. Your edits are still here. Reload saved settings before trying again.',
  CONFIG_STORAGE_UNAVAILABLE: 'Storage is unavailable. Configuration cannot be saved until storage is restored.',
  CONFIG_WRITE_UNCERTAIN: 'The save outcome is unknown. Reload saved settings before making another change.',
  CONFIG_STORED_INVALID: 'The stored configuration is invalid. Reload saved settings or correct the highlighted fields.',
  CONFIG_ENCRYPTION_UNAVAILABLE: 'Backend key setup is unavailable. Credentials cannot be saved until it is corrected.',
  CONFIG_ACTIVATION_UNAVAILABLE: 'Activation is unavailable. Saved settings cannot be applied to new work yet.',
  CREDENTIAL_REJECTED: 'The provider did not recognize this key. Correct it and try again.',
  CREDENTIAL_VALIDATION_TIMEOUT: 'The provider did not respond in time. Retry the key check.',
  CREDENTIAL_PROVIDER_RATE_LIMITED: 'Try again later.',
  CREDENTIAL_PROVIDER_UNAVAILABLE: 'The provider is unavailable. Retry without changing unrelated settings.',
  CREDENTIAL_PROVIDER_RESPONSE_INVALID: 'The provider response was invalid. Retry the key check.',
  ADMIN_RATE_LIMITED: 'Try again later.',
  INVALID_ADMIN_ORIGIN: 'Use a trusted origin over HTTPS, or explicit localhost development.',
  ADMIN_TRANSPORT_REQUIRED: 'Use a trusted origin over HTTPS, or explicit localhost development.',
};

const CLIENT_ERROR_COPY = {
  NETWORK_ERROR: 'The configuration request could not be completed.',
  ABORTED: 'The save outcome is unknown. Reload saved settings before making another change.',
  ADMIN_REQUEST_TIMEOUT: 'The request timed out. Reload saved settings before making another change.',
  INVALID_ADMIN_RESPONSE: 'The server returned an invalid configuration response. Reload saved settings before making another change.',
  INVALID_ADMIN_REQUEST: 'The configuration request is invalid.',
} as const;

export function errorCopy(code: string): string {
  if ((ADMIN_CONFIG_ERROR_CODES as readonly string[]).includes(code)) {
    return ADMIN_ERROR_COPY[code as AdminConfigErrorCode];
  }
  return CLIENT_ERROR_COPY[code as keyof typeof CLIENT_ERROR_COPY] ?? CLIENT_ERROR_COPY.NETWORK_ERROR;
}
