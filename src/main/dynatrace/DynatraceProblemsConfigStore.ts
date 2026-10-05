import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { replaceFileDurablySync } from '../utils/durableFile';
import {
  validWorkflowDqlTask,
  getDynatraceApiTokenError,
  getDynatraceCustomDqlMatcherError,
  getDynatraceEnvironmentUrlError,
  getDynatraceWorkflowIdError,
  normalizeDynatraceCustomDqlMatcher,
  normalizeDynatraceEnvironmentUrl,
  normalizeDynatraceOAuthCredentials,
  type DynatraceOAuthCredentials,
  type DynatraceProblemScopeInput,
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
} from '@shared/dynatraceProblems';
import { loggers } from '../logger';

export type DynatraceProblemsConfig = {
  /** In-memory only: block admission when the configured source could not be refreshed. */
  workflowScopeError?: string;
  environmentUrl: string;
  apiToken: string;
  oauth?: DynatraceOAuthCredentials;
  /** Null means the active scope is unfiltered or custom DQL. */
  alertingProfiles: string[] | null;
  /** Null means the active scope is unfiltered or alerting profiles. */
  customDqlMatcher: string | null;
  rememberedAlertingProfiles?: string[];
  workflowId?: string;
  workflowDqlTask?: string;
};

type StoredDynatraceProblemsConfig = {
  environmentUrl: string;
  encryptedApiToken?: string;
  encryptedOAuthCredentials?: string;
  /** Development/test fallback only. */
  oauth?: DynatraceOAuthCredentials;
  /** Development/test migration fallback. Packaged Relay never writes this field. */
  apiToken?: string;
  alertingProfiles?: string[] | null;
  customDqlMatcher?: string | null;
  rememberedAlertingProfiles?: string[];
  workflowId?: string;
  workflowDqlTask?: string;
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

function storedWorkflowSource(value: unknown): { workflowId?: string } {
  return typeof value === 'string' && !getDynatraceWorkflowIdError(value)
    ? { workflowId: value }
    : {};
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

      const credentials = this.readCredentials(stored);
      if (!credentials) return null;

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

      if (!validWorkflowDqlTask(stored.workflowDqlTask)) return null;
      const config = {
        environmentUrl,
        ...(stored.workflowDqlTask === undefined
          ? {}
          : { workflowDqlTask: stored.workflowDqlTask }),
        ...credentials,
        alertingProfiles: customDqlMatcher
          ? null
          : normalizeAlertingProfiles(stored.alertingProfiles),
        customDqlMatcher,
        ...(stored.rememberedAlertingProfiles === undefined
          ? {}
          : {
              rememberedAlertingProfiles:
                normalizeAlertingProfiles(stored.rememberedAlertingProfiles) ?? [],
            }),
        ...storedWorkflowSource(stored.workflowId),
      };
      if ((stored.apiToken || stored.oauth) && this.runtime.secureStorage?.isEncryptionAvailable())
        this.write(config);
      return config;
    } catch {
      loggers.main.error('Failed to load Dynatrace Problems configuration');
      return null;
    }
  }

  private readCredentials(
    stored: StoredDynatraceProblemsConfig,
  ): Pick<DynatraceProblemsConfig, 'apiToken' | 'oauth'> | null {
    const secureStorage = this.runtime.secureStorage;
    if (stored.encryptedOAuthCredentials || stored.oauth) {
      let credentials: unknown = null;
      if (stored.encryptedOAuthCredentials && secureStorage?.isEncryptionAvailable()) {
        credentials = JSON.parse(
          secureStorage.decryptString(Buffer.from(stored.encryptedOAuthCredentials, 'base64')),
        );
      } else if (!this.runtime.isPackaged) {
        credentials = stored.oauth;
      }
      const oauth = normalizeDynatraceOAuthCredentials(credentials);
      return oauth ? { apiToken: '', oauth } : null;
    }
    let apiToken = '';
    if (stored.encryptedApiToken && secureStorage?.isEncryptionAvailable()) {
      apiToken = secureStorage.decryptString(Buffer.from(stored.encryptedApiToken, 'base64'));
    } else if (stored.apiToken && !this.runtime.isPackaged) {
      apiToken = stored.apiToken;
    }
    return getDynatraceApiTokenError(apiToken) ? null : { apiToken };
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
    const config = this.prepare(input);
    this.write(config);
    return config;
  }

  prepare(input: DynatraceProblemsSettingsInput): DynatraceProblemsConfig {
    const environmentError = getDynatraceEnvironmentUrlError(input.environmentUrl);
    if (environmentError) throw new Error(environmentError);

    const existing = this.load();
    if (input.oauth && input.apiToken?.trim())
      throw new Error('Choose one Dynatrace authentication method.');
    let oauth = input.apiToken?.trim() ? null : existing?.oauth;
    if (input.oauth !== undefined) oauth = normalizeDynatraceOAuthCredentials(input.oauth);
    if (input.oauth !== undefined && !oauth)
      throw new Error('Enter a valid OAuth client ID, client secret, and account UUID.');
    const apiToken = oauth ? '' : input.apiToken?.trim() || existing?.apiToken || '';
    if (!oauth) {
      const tokenError = getDynatraceApiTokenError(apiToken);
      if (tokenError) throw new Error(tokenError);
    }

    const config = {
      environmentUrl: normalizeDynatraceEnvironmentUrl(input.environmentUrl),
      apiToken,
      ...(oauth ? { oauth } : {}),
      alertingProfiles: existing?.alertingProfiles ?? null,
      customDqlMatcher: existing?.customDqlMatcher ?? null,
      ...(existing?.rememberedAlertingProfiles === undefined
        ? {}
        : { rememberedAlertingProfiles: existing.rememberedAlertingProfiles }),
      ...(existing?.workflowId ? { workflowId: existing.workflowId } : {}),
      ...(existing?.workflowDqlTask === undefined
        ? {}
        : { workflowDqlTask: existing.workflowDqlTask }),
    };
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
      ...(config?.rememberedAlertingProfiles === undefined
        ? {}
        : { rememberedAlertingProfiles: config.rememberedAlertingProfiles }),
      ...(config?.workflowId ? { workflowId: config.workflowId } : {}),
      ...(config?.workflowDqlTask === undefined ? {} : { workflowDqlTask: config.workflowDqlTask }),
    };
  }

  saveProblemScope(input: DynatraceProblemScopeInput): DynatraceProblemsConfig {
    const existing = this.load();
    if (!existing) throw new Error('Configure Dynatrace Problems before saving problem scope.');
    if (input.workflowDqlTask !== null && !validWorkflowDqlTask(input.workflowDqlTask))
      throw new Error('Invalid workflow DQL task.');
    const matcherError = getDynatraceCustomDqlMatcherError(input.customDqlMatcher);
    if (matcherError) throw new Error(matcherError);
    if (input.workflowId !== undefined) {
      const workflowError = getDynatraceWorkflowIdError(input.workflowId.trim());
      if (workflowError) throw new Error(workflowError);
    }
    const customDqlMatcher = normalizeDynatraceCustomDqlMatcher(input.customDqlMatcher) || null;
    const config = {
      ...existing,
      alertingProfiles: customDqlMatcher ? null : normalizeAlertingProfiles(input.alertingProfiles),
      customDqlMatcher,
      rememberedAlertingProfiles:
        normalizeAlertingProfiles(
          input.rememberedAlertingProfiles ??
            (input.alertingProfiles.length
              ? input.alertingProfiles
              : (existing.rememberedAlertingProfiles ?? existing.alertingProfiles)),
        ) ?? [],
      ...(input.workflowId !== undefined ? { workflowId: input.workflowId.trim() } : {}),
    };
    if (input.workflowDqlTask == null || !customDqlMatcher) delete config.workflowDqlTask;
    else config.workflowDqlTask = input.workflowDqlTask;
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
      ...(config.rememberedAlertingProfiles === undefined
        ? {}
        : { rememberedAlertingProfiles: config.rememberedAlertingProfiles }),
      ...(config.workflowId ? { workflowId: config.workflowId } : {}),
      ...(config.workflowDqlTask === undefined ? {} : { workflowDqlTask: config.workflowDqlTask }),
    };

    if (secureStorage?.isEncryptionAvailable()) {
      if (config.oauth)
        stored.encryptedOAuthCredentials = secureStorage
          .encryptString(JSON.stringify(config.oauth))
          .toString('base64');
      else
        stored.encryptedApiToken = secureStorage.encryptString(config.apiToken).toString('base64');
    } else {
      if (this.runtime.isPackaged) {
        throw new Error('Secure storage is unavailable; refusing to save Dynatrace credentials.');
      }
      if (config.oauth) stored.oauth = config.oauth;
      else stored.apiToken = config.apiToken;
    }

    replaceFileDurablySync(
      `${this.configPath}.tmp`,
      this.configPath,
      JSON.stringify(stored, null, 2),
      {
        mode: 0o600,
      },
    );
  }
}
