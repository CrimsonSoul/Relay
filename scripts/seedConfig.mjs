export function getSuperuserPassword(env) {
  const password = env.RELAY_SEED_SUPERUSER_PASSWORD;

  if (!password) {
    throw new Error('Missing RELAY_SEED_SUPERUSER_PASSWORD for seed superuser authentication');
  }

  return password;
}
