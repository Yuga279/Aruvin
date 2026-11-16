/**
 * ============================================================================
 * FILE: integration-fixture.ts
 * LOCATION: backend/test/admin-config/integration-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Reserved small native AppModule fixture for guarded integration checks.
 *
 * ROLE IN PROJECT:
 *    Integration fixture implementation is blocked on operator-supplied
 *    isolated replica-set prerequisites in this environment. Production owners
 *    and guarded persistence bundles remain unchanged.
 *
 * KEY COMPONENTS:
 *    - openAdminIntegration: Not yet implemented on non-native runs.
 * ============================================================================
 */
export async function openAdminIntegration(): Promise<never> {
  throw new Error('Isolated native test configuration is required.');
}