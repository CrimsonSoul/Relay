import { app, safeStorage } from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  getDynatraceApiTokenError,
  getDynatraceCustomDqlMatcherError,
  getDynatraceEnvironmentUrlError,
  normalizeDynatraceCustomDqlMatcher,
  normalizeDynatraceEnvironmentUrl,
  type DynatraceProblemScopeInput,
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
} from '@shared/dynatraceProblems';
import { loggers } from '../logger';

export type DynatraceProblemsConfig = {
  environmentUrl: string;
  apiToken: string;
  /** Null means the active scope is unfiltered or custom DQL. */
  alertingProfiles: string[] | null;
  /** Null means the active scope is unfiltered or alerting profiles. */
  customDqlMatcher: string | null;
};

type StoredDynatraceProblemsConfig = {
  environmentUrl: string;
  encryptedApiToken?: string;
  /** Development/test migration fallback. Packaged Relay never writes this field. */
  apiToken?: string;
  alertingProfiles?: string[] | null;
  customDqlMatcher?: string | null;
};

type SecureStorageAdapter = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
>;

type RuntimeAdapter = {
  isPackaged: boolean;
  secureStorage: SecureStorageAdapter | null;
};

function defaultRuntime(): RuntimeAdapter {
  return { isPackaged: app.isPackaged, secureStorage: safeStorage };
}

function normalizeAlertingProfiles(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const profiles = [
    ...new Set(
      value
        .filter((profile): profile is string => typeof profile === 'string')
        .map((profile) => profile.trim())
        .filter(Boolean),
    ),
  ];
  return profiles.length > 0 ? profiles : null;
}

export class DynatraceProblemsConfigStore {
  private readonly configPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly runtime: RuntimeAdapter = defaultRuntime(),
  ) {
    this.configPath = join(dataDir, 'dynatrace-problems.json');
  }

  load(): DynatraceProblemsConfig | null {
    if (!existsSync(this.configPath)) return null;

    try {
      const stored = JSON.parse(
        readFileSync(this.configPath, 'utf8'),
      ) as StoredDynatraceProblemsConfig;
      const environmentUrl = normalizeDynatraceEnvironmentUrl(stored.environmentUrl ?? '');
      if (!environmentUrl) return null;

      const secureStorage = this.runtime.secureStorage;
      let apiToken = '';
      if (stored.encryptedApiToken && secureStorage?.isEncryptionAvailable()) {
        apiToken = secureStorage.decryptString(Buffer.from(stored.encryptedApiToken, 'base64'));
      } else if (stored.apiToken && !this.runtime.isPackaged) {
        apiToken = stored.apiToken;
      }

      if (getDynatraceApiTokenError(apiToken)) return null;

      let customDqlMatcher: string | null = null;
      if (stored.customDqlMatcher !== undefined && stored.customDqlMatcher !== null) {
        if (
          typeof stored.customDqlMatcher !== 'string' ||
          getDynatraceCustomDqlMatcherError(stored.customDqlMatcher)
        ) {
          return null;
        }
        customDqlMatcher = normalizeDynatraceCustomDqlMatcher(stored.customDqlMatcher) || null;
      }

      const config = {
        environmentUrl,
        apiToken,
        alertingProfiles: customDqlMatcher
          ? null
          : normalizeAlertingProfiles(stored.alertingProfiles),
        customDqlMatcher,
      };
      if (stored.apiToken && secureStorage?.isEncryptionAvailable()) this.write(config);
      return config;
    } catch (error) {
      loggers.main.error('Failed to load Dynatrace Problems configuration', { error });
      return null;
    }
  }

  getPublicSettings(): DynatraceProblemsPublicSettings {
    const config = this.load();
    return {
      configured: config !== null,
      environmentUrl: config?.environmentUrl ?? '',
      profileFilterConfigured: config?.alertingProfiles !== null && config !== null,
      selectedAlertingProfiles: config?.alertingProfiles ?? [],
    };
  }

  save(input: DynatraceProblemsSettingsInput): DynatraceProblemsConfig {
    const environmentError = getDynatraceEnvironmentUrlError(input.environmentUrl);
    if (environmentError) throw new Error(environmentError);

    const existing = this.load();
    const apiToken = input.apiToken?.trim() || existing?.apiToken || '';
    const tokenError = getDynatraceApiTokenError(apiToken);
    if (tokenError) throw new Error(tokenError);

    const config = {
      environmentUrl: normalizeDynatraceEnvironmentUrl(input.environmentUrl),
      apiToken,
      alertingProfiles: existing?.alertingProfiles ?? null,
      customDqlMatcher: existing?.customDqlMatcher ?? null,
    };
    this.write(config);
    return config;
  }

  saveAlertingProfiles(alertingProfiles: string[]): DynatraceProblemsConfig {
    const existing = this.load();
    if (!existing) throw new Error('Configure Dynatrace Problems before saving a profile filter.');
    return this.saveProblemScope({
      alertingProfiles,
      customDqlMatcher: '',
    });
  }

  getAdministrativeScope(): DynatraceProblemScopeInput {
    const config = this.load();
    return {
      alertingProfiles: config?.alertingProfiles ?? [],
      customDqlMatcher: config?.customDqlMatcher ?? '',
    };
  }

  saveProblemScope(input: DynatraceProblemScopeInput): DynatraceProblemsConfig {
    const existing = this.load();
    if (!existing) throw new Error('Configure Dynatrace Problems before saving problem scope.');
    const matcherError = getDynatraceCustomDqlMatcherError(input.customDqlMatcher);
    if (matcherError) throw new Error(matcherError);
    const customDqlMatcher = normalizeDynatraceCustomDqlMatcher(input.customDqlMatcher) || null;
    const config = {
      ...existing,
      alertingProfiles: customDqlMatcher ? null : normalizeAlertingProfiles(input.alertingProfiles),
      customDqlMatcher,
    };
    this.write(config);
    return config;
  }

  clear(): boolean {
    try {
      if (existsSync(this.configPath)) unlinkSync(this.configPath);
      return true;
    } catch (error) {
      loggers.main.error('Failed to clear Dynatrace Problems configuration', { error });
      return false;
    }
  }

  private write(config: DynatraceProblemsConfig): void {
    mkdirSync(this.dataDir, { recursive: true });
    const secureStorage = this.runtime.secureStorage;
    const stored: StoredDynatraceProblemsConfig = {
      environmentUrl: config.environmentUrl,
      alertingProfiles: config.alertingProfiles,
      customDqlMatcher: config.customDqlMatcher,
    };

    if (secureStorage?.isEncryptionAvailable()) {
      stored.encryptedApiToken = secureStorage.encryptString(config.apiToken).toString('base64');
    } else {
      if (this.runtime.isPackaged) {
        throw new Error(
          'Secure storage is unavailable; refusing to save the Dynatrace platform token.',
        );
      }
      stored.apiToken = config.apiToken;
    }

    const tmpPath = `${this.configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpPath, this.configPath);
  }
}
