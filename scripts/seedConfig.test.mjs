import test from 'node:test';
import assert from 'node:assert/strict';

import { getSuperuserPassword } from './seedConfig.mjs';

const buildSeedPassword = () => ['seed', 'fixture', 'value'].join('-');

test('getSuperuserPassword returns RELAY_SEED_SUPERUSER_PASSWORD', () => {
  const seedPassword = buildSeedPassword();

  assert.equal(getSuperuserPassword({ RELAY_SEED_SUPERUSER_PASSWORD: seedPassword }), seedPassword);
});

test('getSuperuserPassword throws when RELAY_SEED_SUPERUSER_PASSWORD is missing', () => {
  assert.throws(
    () => getSuperuserPassword({}),
    /RELAY_SEED_SUPERUSER_PASSWORD/,
  );
});
