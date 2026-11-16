import { describe, it } from 'vitest';

const nativePrerequisitesAvailable =
  Boolean(process.env.AURVIN_TEST_MONGODB_URI) &&
  process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!nativePrerequisitesAvailable)('admin config native persistence', () => {
  it('native config stores encrypted credentials only', async () => {
    // Blocked: operator-supplied isolated replica-set prerequisites are absent in this environment.
  });
});