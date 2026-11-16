/**
 * ============================================================================
 * FILE: assembled-harness.spec.ts
 * LOCATION: backend/test/integration/assembled-harness.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove fixture generation IDs stay unique across POSTs and shared-DB restarts.
 *
 * ROLE IN PROJECT:
 *    Locks the P10 assembled-harness rewrite so accounting keeps literal
 *    gen_fixture on the first POST while later POSTs cannot collide.
 *
 * KEY COMPONENTS:
 *    - uniqueFixtureFrames: First POST keeps gen_fixture; later POSTs suffix.
 * ============================================================================
 */

import { uniqueFixtureFrames } from './assembled-harness.js';

const SAMPLE = 'data: {"id":"gen_fixture","choices":[]}\n\n';

it('keeps literal gen_fixture on the first POST for a database owner', () => {
  expect(uniqueFixtureFrames({}, SAMPLE)).toBe(SAMPLE);
});

it('suffixes later POSTs with a per-run prefix that survives the same owner', () => {
  const owner = {};
  const first = uniqueFixtureFrames(owner, SAMPLE);
  const second = uniqueFixtureFrames(owner, SAMPLE);
  const third = uniqueFixtureFrames(owner, SAMPLE);
  expect(first).toBe(SAMPLE);
  expect(second).not.toBe(SAMPLE);
  expect(second).not.toBe(third);
  expect(second).toMatch(/"id":"gen_fixture_[0-9a-f]+_2"/u);
  expect(third).toMatch(/"id":"gen_fixture_[0-9a-f]+_3"/u);
  const prefix = second.match(/gen_fixture_([0-9a-f]+)_2/u)?.[1];
  expect(prefix).toBeTruthy();
  expect(third).toContain(`gen_fixture_${prefix}_3`);
});

it('starts a different database owner at gen_fixture', () => {
  const firstDb = {};
  const secondDb = {};
  expect(uniqueFixtureFrames(firstDb, SAMPLE)).toBe(SAMPLE);
  expect(uniqueFixtureFrames(firstDb, SAMPLE)).not.toBe(SAMPLE);
  expect(uniqueFixtureFrames(secondDb, SAMPLE)).toBe(SAMPLE);
  expect(uniqueFixtureFrames(secondDb, SAMPLE)).not.toBe(SAMPLE);
});
