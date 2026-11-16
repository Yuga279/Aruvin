import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { CALENDAR_SCOPES_V1 } from './calendar-policy.js';
import type { CalendarAccountBinding } from './calendar-discovery.js';

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const encryptedCalendarSecretSchema = z.object({ version: z.literal(1),
  iv: z.string().min(1).max(64), tag: z.string().min(1).max(64),
  ciphertext: z.string().min(1).max(16384) }).strict();
export type EncryptedCalendarSecret = z.infer<typeof encryptedCalendarSecretSchema>;
export const calendarCredentialAadSchema = z.object({ version: z.literal(1), userId: idSchema,
  provider: z.literal('google-calendar'), connectionId: idSchema,
  credentialVersion: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255),
  tokenKind: z.enum(['access', 'refresh']) }).strict();
export const loopbackRedirectSchema = z.string().max(2048).url().refine(value => {
  const u = new URL(value);
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    && !u.username && !u.password && !u.search && !u.hash
    && u.pathname === '/api/plugins/google-calendar/oauth/callback';
});
export const calendarOAuthOptionsSchema = z.object({ clientId: z.string().min(1).max(500),
  redirectUri: loopbackRedirectSchema, targetCalendarId: z.string().min(1).max(1024),
}).strict();
export const connectionRecordSchema = z.object({ schemaVersion: z.literal(1), userId: idSchema,
  provider: z.literal('google-calendar'), connectionId: idSchema,
  revision: z.number().int().positive(), connectionRevision: z.number().int().positive(),
  credentialVersion: z.number().int().positive(),
  googleSubjectId: z.string().min(1).max(255), accountEmail: z.string().email().max(320).nullable(),
  calendarId: z.string().min(1).max(1024), targetRevision: z.number().int().positive(),
  enabled: z.boolean(), status: z.enum(['connected', 'disconnected', 'reconnect-required', 'degraded']),
  credentials: z.object({ access: encryptedCalendarSecretSchema.nullable(),
    refresh: encryptedCalendarSecretSchema }).strict().nullable(),
  tokenExpiresAt: isoDateSchema.nullable(), grantedScopes: z.array(z.string().min(1).max(200)).max(10),
  updatedAt: isoDateSchema,
}).strict().superRefine((v, ctx) => {
  if (v.status === 'connected' && (!v.credentials || !CALENDAR_SCOPES_V1.every(s => v.grantedScopes.includes(s))))
    ctx.addIssue({ code: 'custom', message: 'Connected state requires credentials and verified scopes.' });
  if (v.status === 'disconnected' && (v.credentials !== null || v.enabled))
    ctx.addIssue({ code: 'custom', message: 'Disconnected credentials must be cleared and disabled.' });
});
export type CalendarConnectionRecord = z.infer<typeof connectionRecordSchema>;
export const oauthStateSchema = z.object({ schemaVersion: z.literal(1),
  kind: z.literal('calendar-oauth-state'), userId: idSchema,
  stateHash: sha256Schema, browserHash: sha256Schema, oidcNonceHash: sha256Schema,
  encryptedVerifier: encryptedCalendarSecretSchema, redirectUri: loopbackRedirectSchema,
  createdAt: isoDateSchema, expiresAt: isoDateSchema, consumedAt: isoDateSchema.nullable(),
}).strict().refine(v => Date.parse(v.expiresAt) > Date.parse(v.createdAt)
  && Date.parse(v.expiresAt) - Date.parse(v.createdAt) <= 600000);
export type CalendarOAuthState = z.infer<typeof oauthStateSchema>;
export type CalendarConnectionCas =
  | { outcome: 'confirmed'; record: CalendarConnectionRecord }
  | { outcome: 'conflict'; currentRevision: number }
  | { outcome: 'uncertain' };
export interface CalendarConnectionStore {
  get(userId: string): Promise<CalendarConnectionRecord | null>;
  create(record: CalendarConnectionRecord): Promise<CalendarConnectionCas>;
  compareAndSwap(userId: string, expectedRevision: number, next: CalendarConnectionRecord): Promise<CalendarConnectionCas>;
  putState(record: CalendarOAuthState): Promise<void>;
  consumeState(input: { userId: string; stateHash: string; browserHash: string; now: string }): Promise<CalendarOAuthState | null>;
}
export type CalendarConnectionBinding = Readonly<{ userId: string; connectionId: string;
  connectionRevision: number; googleSubjectId: string; calendarId: string; targetRevision: number }>;
export interface CalendarCredentialPort {
  withAccessToken<T>(input: { binding: CalendarConnectionBinding; signal: AbortSignal;
    deadlineAt: string; consumeRefreshRequest: () => Promise<void> },
    action: (accessToken: string) => Promise<T>): Promise<T>;
}
export interface GoogleIdentityPort {
  verify(input: { idToken: string; clientId: string; expectedNonceHash: string;
    now: string; signal: AbortSignal }): Promise<{ subject: string; email: string | null }>;
}
export interface CalendarConnectionGate {
  requireCurrent(binding: CalendarConnectionBinding, signal: AbortSignal): Promise<void>;
}
export interface CalendarTargetPort {
  verifyOwnedTarget(input: { calendarId: string; googleSubjectId: string; accessToken: string;
    signal: AbortSignal; deadlineAt: string; consumeRequest: () => Promise<void> }): Promise<{
      calendarId: string; googleSubjectId: string; verifiedAt: string; proofRevision: string;
    }>;
}

export const calendarOAuthOptionsV2Schema = calendarOAuthOptionsSchema.extend({
  // Deprecated configuration is accepted for compatibility, never a v2 targeting authority.
  targetCalendarId: z.string().min(1).max(1024).optional(),
}).strict();
export type CalendarOAuthOptionsV2 = z.infer<typeof calendarOAuthOptionsV2Schema>;
export interface CalendarAccountCredentialPort {
  withAccessToken<T>(input: { account: CalendarAccountBinding; signal: AbortSignal;
    deadlineAt: string; consumeRefreshRequest: () => Promise<void> },
    action: (accessToken: string) => Promise<T>): Promise<T>;
}
