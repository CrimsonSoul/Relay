import PocketBase from 'pocketbase';
import { loggers } from '../../logger';

const logger = loggers.pocketbase;
const PRIVILEGED_REAUTHENTICATION_RATE_LIMIT_LABEL = 'POST /api/relay/privileged/reauth';
const PRIVILEGED_REAUTHENTICATION_RATE_LIMIT = {
  label: PRIVILEGED_REAUTHENTICATION_RATE_LIMIT_LABEL,
  audience: '@auth',
  duration: 3,
  maxRequests: 2,
} as const;
const KNOWLEDGE_SEARCH_BATCH_MAX_REQUESTS = 100;
const KNOWLEDGE_SEARCH_BATCH_MIN_BODY_BYTES = 2 * 1024 * 1024;
const POCKETBASE_DEFAULT_BATCH_TIMEOUT_SECONDS = 3;

function finiteNumber(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : fallback;
}

export async function ensurePocketBaseAuthRateLimit(pb: PocketBase): Promise<void> {
  let settings: Record<string, unknown>;
  try {
    settings = await pb.settings.getAll({ requestKey: null });
  } catch (error) {
    logger.error('Failed to read required PocketBase authentication rate-limit settings', {
      error,
    });
    throw new Error('Failed to read required PocketBase authentication rate-limit settings', {
      cause: error,
    });
  }

  const rateLimits =
    settings.rateLimits &&
    typeof settings.rateLimits === 'object' &&
    !Array.isArray(settings.rateLimits)
      ? (settings.rateLimits as Record<string, unknown>)
      : null;
  const rules = Array.isArray(rateLimits?.rules) ? rateLimits.rules : [];
  const hasAuthRule = rules.some((rule) => {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return false;
    const record = rule as Record<string, unknown>;
    return (
      record.label === '*:auth' &&
      record.audience === '' &&
      typeof record.duration === 'number' &&
      Number.isFinite(record.duration) &&
      record.duration > 0 &&
      Number.isSafeInteger(record.maxRequests) &&
      (record.maxRequests as number) > 0
    );
  });

  if (!rateLimits || !hasAuthRule) {
    throw new Error('PocketBase has no authoritative authentication rate-limit rule');
  }
  const privilegedRouteRules = rules.filter(
    (rule) =>
      rule !== null &&
      typeof rule === 'object' &&
      !Array.isArray(rule) &&
      (rule as Record<string, unknown>).label === PRIVILEGED_REAUTHENTICATION_RATE_LIMIT_LABEL,
  );
  const acceptablePrivilegedRouteRule = privilegedRouteRules.find((rule) => {
    const record = rule as Record<string, unknown>;
    return (
      record.audience === '@auth' &&
      typeof record.duration === 'number' &&
      Number.isFinite(record.duration) &&
      record.duration >= PRIVILEGED_REAUTHENTICATION_RATE_LIMIT.duration &&
      Number.isSafeInteger(record.maxRequests) &&
      (record.maxRequests as number) > 0 &&
      (record.maxRequests as number) <= PRIVILEGED_REAUTHENTICATION_RATE_LIMIT.maxRequests
    );
  });
  const managedRules = [
    ...rules.filter(
      (rule) =>
        rule === null ||
        typeof rule !== 'object' ||
        Array.isArray(rule) ||
        (rule as Record<string, unknown>).label !== PRIVILEGED_REAUTHENTICATION_RATE_LIMIT_LABEL,
    ),
    acceptablePrivilegedRouteRule ?? PRIVILEGED_REAUTHENTICATION_RATE_LIMIT,
  ];
  const routeRuleIsCanonical =
    privilegedRouteRules.length === 1 && acceptablePrivilegedRouteRule !== undefined;
  if (rateLimits.enabled === true && routeRuleIsCanonical) return;

  try {
    await pb.settings.update(
      {
        rateLimits: {
          ...rateLimits,
          enabled: true,
          rules: managedRules,
        },
      },
      { requestKey: null },
    );
    logger.info('Enabled required PocketBase authentication rate limits');
  } catch (error) {
    logger.error('Failed to enable required PocketBase authentication rate limits', {
      error,
    });
    throw new Error('Failed to enable required PocketBase authentication rate limits', {
      cause: error,
    });
  }
}

export async function ensureKnowledgeBatchApi(pb: PocketBase): Promise<void> {
  let settings: Record<string, unknown>;
  try {
    settings = await pb.settings.getAll({ requestKey: null });
  } catch (err) {
    logger.error('Failed to read required PocketBase batch settings', {
      error: err,
    });
    throw new Error('Failed to read required PocketBase batch settings', {
      cause: err,
    });
  }

  const current =
    settings.batch && typeof settings.batch === 'object'
      ? (settings.batch as Record<string, unknown>)
      : {};
  const currentMaxRequests = finiteNumber(current.maxRequests, 0, 0);
  const currentMaxBodySize = finiteNumber(current.maxBodySize, 0, 0);
  const bodyCapFitsWriteBatch =
    currentMaxBodySize === 0 || currentMaxBodySize >= KNOWLEDGE_SEARCH_BATCH_MIN_BODY_BYTES;
  if (
    current.enabled === true &&
    currentMaxRequests >= KNOWLEDGE_SEARCH_BATCH_MAX_REQUESTS &&
    bodyCapFitsWriteBatch
  ) {
    return;
  }

  const batch = {
    enabled: true,
    maxRequests: Math.max(currentMaxRequests, KNOWLEDGE_SEARCH_BATCH_MAX_REQUESTS),
    timeout: finiteNumber(
      current.timeout,
      POCKETBASE_DEFAULT_BATCH_TIMEOUT_SECONDS,
      Number.EPSILON,
    ),
    // PocketBase uses 0 for its ~128 MiB default. Preserve that sentinel;
    // otherwise make sure a full 100-passage write batch fits.
    maxBodySize:
      currentMaxBodySize === 0
        ? 0
        : Math.max(currentMaxBodySize, KNOWLEDGE_SEARCH_BATCH_MIN_BODY_BYTES),
  };
  try {
    // Send only the complete nested batch value. PocketBase requires maxRequests
    // and timeout, while unrelated application settings must remain untouched.
    await pb.settings.update({ batch }, { requestKey: null });
    logger.info('Enabled required PocketBase batch API');
  } catch (err) {
    logger.error('Failed to enable required PocketBase batch API', {
      error: err,
    });
    throw new Error('Failed to enable required PocketBase batch API', {
      cause: err,
    });
  }
}
