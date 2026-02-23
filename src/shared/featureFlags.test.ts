import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type FeatureFlagsModule = typeof import('./featureFlags');

describe('featureFlags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadModule(
    env: Record<string, string | undefined> = {},
  ): Promise<FeatureFlagsModule> {
    process.env = { ...originalEnv, ...env };
    return import('./featureFlags');
  }

  it('returns expected default values in production', async () => {
    const mod = await loadModule({ NODE_ENV: 'production', VERBOSE_LOGGING: undefined });

    expect(mod.isFeatureEnabled('enableAIChat')).toBe(true);
    expect(mod.isFeatureEnabled('enablePerformanceMetrics')).toBe(false);
    expect(mod.featureFlags.getFlag('enableStrictCSP')?.enabled).toBe(true);
  });

  it('enables dev override flags in development', async () => {
    const mod = await loadModule({ NODE_ENV: 'development' });
    expect(mod.isFeatureEnabled('enablePerformanceMetrics')).toBe(true);
    expect(mod.isFeatureEnabled('enableDebugMode')).toBe(true);
  });

  it('applies environment overrides for feature flags', async () => {
    const mod = await loadModule({ FEATURE_FLAG_ENABLE_DARK_MODE: 'false' });
    expect(mod.isFeatureEnabled('enableDarkMode')).toBe(false);
  });

  it('supports runtime enable/disable and restart-required listing', async () => {
    const mod = await loadModule();

    mod.featureFlags.disableFlag('enableTooltips');
    expect(mod.isFeatureEnabled('enableTooltips')).toBe(false);

    mod.featureFlags.enableFlag('enableTooltips');
    expect(mod.isFeatureEnabled('enableTooltips')).toBe(true);

    const requiresRestart = mod.featureFlags.getFlagsRequiringRestart();
    expect(requiresRestart).toContain('enableStrictCSP');
    expect(requiresRestart).toContain('enableWebviewSandbox');
  });

  it('evaluates rollout percentages consistently by user id', async () => {
    const mod = await loadModule();
    mod.featureFlags.setUserId('user-a');

    const flag = mod.featureFlags.getFlag('enableSQLiteMigration');
    expect(flag).toBeDefined();

    if (flag) {
      flag.enabled = false;
      flag.rolloutPercentage = 100;
      expect(mod.isFeatureEnabled('enableSQLiteMigration')).toBe(true);

      flag.rolloutPercentage = 0;
      expect(mod.isFeatureEnabled('enableSQLiteMigration')).toBe(false);
    }
  });

  it('returns fallback/component through withFeatureFlag', async () => {
    const mod = await loadModule();

    mod.featureFlags.disableFlag('enableTooltips');
    const WrappedDisabled = mod.withFeatureFlag(
      (_props: { label: string }) => 'enabled',
      'enableTooltips',
      'fallback',
    );
    expect(WrappedDisabled({ label: 'x' })).toBe('fallback');

    mod.featureFlags.enableFlag('enableTooltips');
    const WrappedEnabled = mod.withFeatureFlag(
      (props: { label: string }) => `enabled-${props.label}`,
      'enableTooltips',
      'fallback',
    );
    expect(WrappedEnabled({ label: 'x' })).toBe('enabled-x');
  });
});
