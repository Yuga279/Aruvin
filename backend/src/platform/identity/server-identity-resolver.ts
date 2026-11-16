/**
 * ============================================================================
 * FILE: server-identity-resolver.ts
 * LOCATION: backend/src/platform/identity/server-identity-resolver.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Resolve the admitted request identity and reject client overrides.
 *
 * ROLE IN PROJECT:
 *    Delegates identity to the shared request store so durable ownership and
 *    OpenRouter attribution use the current account, never a configured default.
 *
 * KEY COMPONENTS:
 *    - ServerIdentityResolver.resolve: Returns the admitted request identity.
 *    - assertNoClientOverrides: Rejects identity, model, and key body fields.
 * ============================================================================
 */

import { Inject, Injectable } from '@nestjs/common';
import type {
  IdentityResolver,
  ResolvedIdentity,
} from '../../contracts/identity.js';
import { AppError } from '../errors/app-error.js';
import { RequestIdentityStore } from './request-identity-store.js';

const IDENTITY_KEYS = ['userId', 'user', 'openRouterUser'] as const;
const MODEL_KEYS = ['model', 'modelId', 'apiKey'] as const;

@Injectable()
export class ServerIdentityResolver implements IdentityResolver {
  constructor(@Inject(RequestIdentityStore) private readonly store: RequestIdentityStore) {}

  resolve(): ResolvedIdentity { return this.store.resolve(); }

  assertNoClientOverrides(body: unknown): void {
    if (!body || typeof body !== 'object') {
      return;
    }

    const record = body as Record<string, unknown>;
    for (const key of IDENTITY_KEYS) {
      if (key in record) {
        throw new AppError(
          'IDENTITY_OVERRIDE_REJECTED',
          'Identity cannot be supplied by the client.',
        );
      }
    }
    for (const key of MODEL_KEYS) {
      if (key in record) {
        throw new AppError(
          'MODEL_OVERRIDE_REJECTED',
          'Model and API keys cannot be supplied by the client.',
        );
      }
    }
  }
}
