/**
 * ============================================================================
 * FILE: persistence-profile.spec.ts
 * LOCATION: backend/src/contracts/persistence-profile.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify service-agnostic persistence profiles, collection names, and versions.
 *
 * ROLE IN PROJECT:
 *    Protects the shared persistence boundary while P2 separately certifies
 *    concrete service capabilities and limits.
 *
 * KEY COMPONENTS:
 *    - Persistence profile tests: Restrict supported profile identifiers.
 *    - Contract version tests: Keep the initial Phase 1 versions stable.
 * ============================================================================
 */

import { COLLECTIONS } from './collections.js';
import {
  CONSERVATIVE_DOCUMENT_HEADROOM_BYTES,
  CONSERVATIVE_DOCUMENT_LIMIT_BYTES,
  documentHeadroomBytes,
  persistenceProfileSchema,
} from './persistence-profile.js';
import { CONTRACT_VERSIONS } from './versions.js';

describe('persistence profile and versions', () => {
  it('accepts the four service-agnostic profiles', () => {
    expect(persistenceProfileSchema.parse('unknown')).toBe('unknown');
    expect(persistenceProfileSchema.parse('native-mongodb')).toBe(
      'native-mongodb',
    );
    expect(persistenceProfileSchema.parse('cosmos-mongodb-ru')).toBe(
      'cosmos-mongodb-ru',
    );
    expect(persistenceProfileSchema.parse('azure-documentdb')).toBe(
      'azure-documentdb',
    );
  });

  it('rejects unknown profile names', () => {
    expect(() => persistenceProfileSchema.parse('cosmos')).toThrow();
  });

  it('keeps document headroom under 2 MB for every profile until a service is certified', () => {
    expect(CONSERVATIVE_DOCUMENT_LIMIT_BYTES).toBe(2_000_000);
    expect(CONSERVATIVE_DOCUMENT_HEADROOM_BYTES).toBe(1_800_000);
    for (const profile of [
      'unknown',
      'native-mongodb',
      'cosmos-mongodb-ru',
      'azure-documentdb',
    ] as const) {
      expect(documentHeadroomBytes(profile)).toBe(1_800_000);
      expect(documentHeadroomBytes(profile)).toBeLessThan(
        CONSERVATIVE_DOCUMENT_LIMIT_BYTES,
      );
    }
  });

  it('names the nine collections including config, integration connections, and users', () => {
    expect(COLLECTIONS).toEqual({
      sessions: 'sessions',
      messages: 'messages',
      agentMemory: 'agent-memory',
      metadata: 'metadata',
      checkpoints: 'checkpoints',
      checkpointWrites: 'checkpoint_writes',
      config: 'config',
      integrationConnections: 'integration_connections',
      users: 'users',
    });
  });

  it('starts all app schemas at version 1', () => {
    expect(CONTRACT_VERSIONS).toEqual({
      api: 1,
      stream: 1,
      session: 1,
      message: 1,
      agentMemory: 1,
      attempt: 1,
      metadata: 1,
      graphSchema: 'phase1.v1',
    });
  });
});
