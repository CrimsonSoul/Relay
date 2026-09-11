export function getSuperuserPassword(env) {
  const password = env.RELAY_SEED_SUPERUSER_PASSWORD;

  if (!password) {
    throw new Error('Missing RELAY_SEED_SUPERUSER_PASSWORD for seed superuser authentication');
  }

  return password;
}

export const SEED_HELP = `Usage: node scripts/seed.mjs MODE
  --help                 Show this help without connecting or changing data.
  --full --disposable    Replace fixture data in an explicitly selected temporary database.
  --dynatrace-only       Seed scoped Dynatrace demo records with configured credentials.
  --clear-dynatrace      Remove scoped Dynatrace demo records with configured credentials.
Full seeding requires RELAY_SEED_PB_URL and RELAY_SEED_PB_DATA_DIR beneath the OS temporary directory.
Scoped modes require RELAY_SEED_SUPERUSER_PASSWORD; RELAY_SEED_PB_URL defaults to http://localhost:8090.`;

export function parseSeedInvocation(argv, env, { temporaryRoot, resolveDirectory }) {
  const allowed = new Set([
    '--help',
    '--full',
    '--disposable',
    '--dynatrace-only',
    '--clear-dynatrace',
  ]);
  if (argv.some((arg) => !allowed.has(arg)) || new Set(argv).size !== argv.length) {
    throw new Error('Unknown or duplicate seed argument. Use --help.');
  }
  if (argv.length === 1 && argv[0] === '--help') return { mode: 'help' };
  const modes = argv.filter((arg) =>
    ['--full', '--dynatrace-only', '--clear-dynatrace'].includes(arg),
  );
  if (modes.length !== 1 || argv.includes('--help'))
    throw new Error('Choose one explicit seed mode. Use --help.');
  const mode = modes[0].slice(2);
  if (mode !== 'full') {
    if (argv.includes('--disposable')) throw new Error('--disposable applies only to --full.');
    return { mode, baseUrl: env.RELAY_SEED_PB_URL || 'http://localhost:8090' };
  }
  if (!argv.includes('--disposable') || !env.RELAY_SEED_PB_URL || !env.RELAY_SEED_PB_DATA_DIR) {
    throw new Error(
      'Full seeding requires --full --disposable and explicit RELAY_SEED_PB_URL and RELAY_SEED_PB_DATA_DIR.',
    );
  }
  const url = new URL(env.RELAY_SEED_PB_URL);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Full seeding requires a credential-free loopback HTTP server URL.');
  }
  const dataDir = resolveDirectory(env.RELAY_SEED_PB_DATA_DIR);
  const temp = resolveDirectory(temporaryRoot);
  // Resolve real paths, including symlinks, before proving the target is disposable.
  if (!dataDir.startsWith(`${temp}/`) && !dataDir.startsWith(`${temp}\\`)) {
    throw new Error(
      'Full seed data directory must already exist beneath the OS temporary directory.',
    );
  }
  return { mode, baseUrl: url.origin, dataDir };
}
