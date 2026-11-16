/**
 * ============================================================================
 * FILE: admin-config.ts
 * LOCATION: backend/src/contracts/admin-config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate strict manageable settings, admin requests, and stored documents.
 *
 * ROLE IN PROJECT:
 *    Owns Zod schemas for configuration JSON while keeping bootstrap, encryption,
 *    and runtime secrets out of the public wire module.
 *
 * KEY COMPONENTS:
 *    - manageableSettingsSchema: Strict nested settings without coercion.
 *    - Request/stored schemas: Added as CAS and encrypted-document contracts land.
 * ============================================================================
 */

import { z } from 'zod';
import { budgetConfigObjectSchema } from './budgets.js';
import { isVoiceLimits } from './voice-wire.js';
import { idSchema } from './identifiers.js';
import {
  MAX_CREDENTIAL_BYTES,
  type ManageableSettings,
} from './admin-config-wire.js';

export const APP_CONFIG_ID = 'aurvin' as const;
export const MAX_CONFIG_DOCUMENT_BYTES = 16_384;
const MAX_EXPECTED_REVISION = Number.MAX_SAFE_INTEGER - 1;
const utf8 = new TextEncoder();

export const MAX_NODE_TIMER_MS = 2_147_483_647;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const safePositiveInt = (max?: number) => {
  const bounded = max === undefined
    ? z.number().finite().int().positive()
    : z.number().finite().int().positive().max(max);
  return bounded.refine((value) => Number.isSafeInteger(value), {
    message: 'expected a safe integer',
  });
};

const timerMs = safePositiveInt(MAX_NODE_TIMER_MS);

const modelIdSchema = z.string().max(200).refine(
  (value) =>
    value === '' ||
    (value.trim() === value && value.length > 0 && !CONTROL_CHARS.test(value)),
  { message: 'invalid model id' },
);

const keytermSchema = z.string().min(1).max(64).refine(
  (value) => value.trim() === value && !CONTROL_CHARS.test(value),
  { message: 'invalid keyterm' },
);

const nullableRateSchema = z.number().finite().nonnegative().nullable();

const chatLimitsSchema = budgetConfigObjectSchema
  .pick({
    maxInputChars: true,
    maxInputTokens: true,
    maxMessagesInContext: true,
    maxContextTokens: true,
    maxOutputTokens: true,
    modelMarginTokens: true,
    titleMaxChars: true,
    maxConcurrentGenerationsPerProcess: true,
    maxRequestsPerMinutePerUser: true,
    retryMaxAttempts: true,
    retryBaseDelayMs: true,
    retryMaxDelayMs: true,
    firstOutputTimeoutMs: true,
    idleStreamTimeoutMs: true,
    totalRunTimeoutMs: true,
  })
  .extend({
    maxInputChars: safePositiveInt(32_000),
    maxInputTokens: safePositiveInt(),
    maxMessagesInContext: safePositiveInt(500),
    maxContextTokens: safePositiveInt(),
    maxOutputTokens: safePositiveInt(),
    modelMarginTokens: safePositiveInt(),
    titleMaxChars: safePositiveInt(80),
    maxConcurrentGenerationsPerProcess: safePositiveInt(),
    maxRequestsPerMinutePerUser: safePositiveInt(),
    retryMaxAttempts: safePositiveInt(3),
    retryBaseDelayMs: timerMs,
    retryMaxDelayMs: timerMs,
    firstOutputTimeoutMs: timerMs,
    idleStreamTimeoutMs: timerMs,
    totalRunTimeoutMs: timerMs,
  })
  .strict();

const voiceLimitsSchema = z
  .object({
    dictationMaxMs: timerMs,
    liveMaxMs: timerMs,
    liveWarningMs: timerMs,
    idleWarningMs: timerMs,
    idleExitAfterWarningMs: timerMs,
    finalizationMs: timerMs,
    reconnectMs: timerMs,
    connectMs: timerMs,
    inputQueueMs: timerMs,
    outputQueueMs: timerMs,
  })
  .strict();

export const manageableSettingsSchema: z.ZodType<ManageableSettings> = z
  .object({
    openRouter: z
      .object({
        modelId: modelIdSchema,
        dataCollection: z.literal('deny'),
        disableTransforms: z.literal(true),
      })
      .strict(),
    chat: chatLimitsSchema,
    voice: z
      .object({
        enabledModes: z
          .object({
            dictation: z.boolean(),
            live: z.boolean(),
          })
          .strict(),
        limits: voiceLimitsSchema,
        dictationWarningMs: timerMs.nullable(),
        quotas: z
          .object({
            identityConcurrent: safePositiveInt(),
            globalConcurrent: safePositiveInt(),
            identityDailyMinutes: safePositiveInt(),
            globalDailyMinutes: safePositiveInt(),
            dailySpendUsd: z.number().finite().positive().nullable(),
          })
          .strict(),
      })
      .strict(),
    deepgram: z
      .object({
        region: z.enum(['us', 'eu']),
        dictationModel: z.literal('nova-3'),
        liveModel: z.literal('flux-general-en'),
        ttsModel: z.enum(['flux-haley-en', 'flux-alexis-en', 'flux-priya-en']),
        endpointingMs: z.number().finite().int().min(300).max(500)
          .refine((value) => Number.isSafeInteger(value)),
        spokenPunctuation: z.boolean(),
        keyterms: z.array(keytermSchema).max(50),
        eotThreshold: z.number().finite().min(0.5).max(1),
        eotTimeoutMs: timerMs,
        rates: z
          .object({
            novaPerMinuteUsd: nullableRateSchema,
            fluxSttPerMinuteUsd: nullableRateSchema,
            fluxTtsPerThousandCharsUsd: nullableRateSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((settings, ctx) => {
    if (!isVoiceLimits(settings.voice.limits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'invalid voice limits',
        path: ['voice', 'limits'],
      });
    }
    const warning = settings.voice.dictationWarningMs;
    if (warning !== null && warning >= settings.voice.limits.dictationMaxMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dictation warning must be below dictation max',
        path: ['voice', 'dictationWarningMs'],
      });
    }
    if (settings.voice.quotas.identityConcurrent > settings.voice.quotas.globalConcurrent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'identity concurrent cannot exceed global concurrent',
        path: ['voice', 'quotas', 'identityConcurrent'],
      });
    }
    if (settings.voice.quotas.identityDailyMinutes > settings.voice.quotas.globalDailyMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'identity daily minutes cannot exceed global daily minutes',
        path: ['voice', 'quotas', 'identityDailyMinutes'],
      });
    }
    if (settings.voice.quotas.dailySpendUsd !== null) {
      const { novaPerMinuteUsd, fluxSttPerMinuteUsd, fluxTtsPerThousandCharsUsd } =
        settings.deepgram.rates;
      if (
        novaPerMinuteUsd === null ||
        fluxSttPerMinuteUsd === null ||
        fluxTtsPerThousandCharsUsd === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'daily spend requires known rates',
          path: ['voice', 'quotas', 'dailySpendUsd'],
        });
      }
    }
    const chat = settings.chat;
    if (chat.maxContextTokens - chat.maxOutputTokens - chat.modelMarginTokens <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'maxContextTokens must leave room for maxOutputTokens and modelMarginTokens',
        path: ['chat', 'maxContextTokens'],
      });
    }
    if (chat.retryMaxDelayMs < chat.retryBaseDelayMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'retryMaxDelayMs must be >= retryBaseDelayMs',
        path: ['chat', 'retryMaxDelayMs'],
      });
    }
    if (chat.retryMaxDelayMs > chat.totalRunTimeoutMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'retryMaxDelayMs must be <= totalRunTimeoutMs',
        path: ['chat', 'retryMaxDelayMs'],
      });
    }
    if (chat.firstOutputTimeoutMs > chat.totalRunTimeoutMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'firstOutputTimeoutMs must be <= totalRunTimeoutMs',
        path: ['chat', 'firstOutputTimeoutMs'],
      });
    }
    if (chat.idleStreamTimeoutMs > chat.totalRunTimeoutMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'idleStreamTimeoutMs must be <= totalRunTimeoutMs',
        path: ['chat', 'idleStreamTimeoutMs'],
      });
    }
  }) satisfies z.ZodType<ManageableSettings>;

const expectedRevisionSchema = z.number().int().nonnegative().max(MAX_EXPECTED_REVISION)
  .refine((value) => Number.isSafeInteger(value));
const storedRevisionSchema = z.number().int().positive()
  .refine((value) => Number.isSafeInteger(value));
const boundedTimestampSchema = z.string().min(1).max(40).refine(
  (value) => !Number.isNaN(Date.parse(value)),
  { message: 'expected ISO-8601 datetime' },
);

const credentialCandidateSchema = z.string().min(1).max(MAX_CREDENTIAL_BYTES).refine((value) =>
  value.trim() === value &&
  !CONTROL_CHARS.test(value) &&
  utf8.encode(value).length <= MAX_CREDENTIAL_BYTES,
);

export const saveSettingsRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    expectedRevision: expectedRevisionSchema,
    settings: manageableSettingsSchema,
  })
  .strict();

export const credentialUpdateRequestSchema = z.discriminatedUnion('action', [
  z.object({
    protocolVersion: z.literal(1),
    expectedRevision: expectedRevisionSchema,
    action: z.literal('replace'),
    candidate: credentialCandidateSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(1),
    expectedRevision: expectedRevisionSchema,
    action: z.literal('remove'),
    confirm: z.literal(true),
  }).strict(),
]);

function canonicalBase64(byteLength: number) {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  return z.string().min(encodedLength).max(encodedLength).refine((value) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const decoded = Buffer.from(value, 'base64');
    return decoded.byteLength === byteLength && decoded.toString('base64') === value;
  });
}

function canonicalBase64Range(minBytes: number, maxBytes: number) {
  const maxEncoded = Math.ceil(maxBytes / 3) * 4;
  return z.string().min(4).max(maxEncoded).refine((value) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const decoded = Buffer.from(value, 'base64');
    return decoded.byteLength >= minBytes &&
      decoded.byteLength <= maxBytes &&
      decoded.toString('base64') === value;
  });
}

const encryptedCredentialEnvelopeSchema = z
  .object({
    algorithm: z.literal('aes-256-gcm'),
    nonce: canonicalBase64(12),
    tag: canonicalBase64(16),
    ciphertext: canonicalBase64Range(1, MAX_CREDENTIAL_BYTES),
  })
  .strict();

const storedCredentialSchema = z
  .object({
    envelope: encryptedCredentialEnvelopeSchema,
    validatedAt: boundedTimestampSchema,
  })
  .strict();

export const storedConfigDocumentSchema = z
  .object({
    _id: z.literal(APP_CONFIG_ID),
    schemaVersion: z.literal(1),
    revision: storedRevisionSchema,
    settings: manageableSettingsSchema,
    credentials: z
      .object({
        openrouter: storedCredentialSchema.nullable(),
        deepgram: storedCredentialSchema.nullable(),
      })
      .strict(),
    updatedAt: boundedTimestampSchema,
    updatedBy: idSchema,
  })
  .strict();

export type EncryptedCredentialEnvelope = z.infer<typeof encryptedCredentialEnvelopeSchema>;
export type StoredCredential = z.infer<typeof storedCredentialSchema>;
export type StoredConfigDocument = z.infer<typeof storedConfigDocumentSchema>;
