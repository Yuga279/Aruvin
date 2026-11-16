/**
 * ============================================================================
 * FILE: accounting-command.spec.ts
 * LOCATION: backend/test/operations/accounting-command.spec.ts
 * PURPOSE: Verify explicit-target dry-run CLI gates and credential-free diagnostics.
 * ROLE IN PROJECT: Injects maintenance/read ports; no database connection is made.
 * KEY COMPONENTS: Opt-in flags, page caps, close lifecycle, static failure categories.
 * ============================================================================
 */
const commandModule = await import('../../src/scripts/migrate-accounting.js').catch(() => null);
async function runAccountingMigrationCommand(options: Parameters<NonNullable<typeof commandModule>['runAccountingMigrationCommand']>[0]) {
  expect(commandModule, 'An explicit dry-run-first maintenance command must exist').not.toBeNull();
  return commandModule!.runAccountingMigrationCommand(options);
}

function fixture() {
  const lines: string[] = []; const close = vi.fn(async () => {});
  const page = vi.fn(async (_query: unknown) => ({ scanned: 1, eligible: 1, converted: 0, unchanged: 0, invalid: 0, conflicts: 0, nextCursor: null as string | null }));
  const read = vi.fn(async () => ({ metadata: { migrateAccountingPage: page }, close }));
  const apply = vi.fn(async () => ({ metadata: { migrateAccountingPage: page }, owner: {}, close }));
  return { lines, close, page, read, apply, options: { env: { AURVIN_ACCOUNTING_MONGODB_URI: 'mongodb://fixture/?replicaSet=fixture' },
    openRead: read as never, openApply: apply as never, stdout: (line: string) => { lines.push(line); }, stderr: (line: string) => { lines.push(line); } } };
}
it('defaults to dry run, requires an explicit target, and closes its one read client', async () => {
  const f = fixture();
  expect(await runAccountingMigrationCommand({ ...f.options, argv: [] })).toBe(1);
  expect(f.read).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  expect(await runAccountingMigrationCommand({ ...f.options, argv: ['--database', 'isolated-accounting'] })).toBe(0);
  expect(f.read).toHaveBeenCalledTimes(1); expect(f.apply).not.toHaveBeenCalled();
  expect(f.page.mock.calls[0][0]).toMatchObject({ apply: false, limit: 50 });
  expect(f.close).toHaveBeenCalledTimes(1);
});
it('requires both apply and stopped-maintenance confirmation and refuses URI arguments', async () => {
  const f = fixture();
  for (const argv of [['--database', 'isolated', '--apply'], ['--database', 'isolated', '--uri', 'private-marker'],
    ['--database', 'admin'], ['--database', 'isolated', '--page-size', '51']]) {
    expect(await runAccountingMigrationCommand({ ...f.options, argv })).toBe(1);
  }
  expect(f.apply).not.toHaveBeenCalled(); expect(f.lines.join('\n')).not.toContain('private-marker');
  expect(await runAccountingMigrationCommand({ ...f.options, argv: ['--database', 'isolated', '--apply', '--maintenance-confirmed'] })).toBe(0);
  expect(f.apply).toHaveBeenCalledTimes(1); expect(f.page.mock.calls[0][0]).toMatchObject({ apply: true, maintenanceConfirmed: true });
});
it('bounds paging and reports continuation/conflicts without credentials or exception payloads', async () => {
  const f = fixture();
  f.page.mockResolvedValue({ scanned: 50, eligible: 50, converted: 0, unchanged: 0, invalid: 0, conflicts: 1, nextCursor: 'a'.repeat(64) });
  expect(await runAccountingMigrationCommand({ ...f.options, argv: ['--database', 'isolated', '--max-pages', '1'] })).toBe(2);
  expect(f.page).toHaveBeenCalledTimes(1); expect(f.lines.join('\n')).toContain('nextCursor');
  f.read.mockRejectedValueOnce(new Error('private-connection-string-payload'));
  expect(await runAccountingMigrationCommand({ ...f.options, argv: ['--database', 'isolated'] })).toBe(1);
  expect(f.lines.join('\n')).not.toContain('private-connection-string-payload');
  expect(f.lines.join('\n')).not.toContain('mongodb://');
});
