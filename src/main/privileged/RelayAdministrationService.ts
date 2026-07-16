import type { DynatraceProblemsPublicSettings } from '@shared/dynatraceProblems';
import {
  RELAY_ADMINISTRABLE_SETTINGS,
  type RelayAdministrableSetting,
  type RelayAdministrationSettingSummary,
} from '@shared/privilegedAccess';
import type { RelayAdministrationSettingReplacePayload } from '@shared/privilegedCommands';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';

export type RelaySettingMutationClass =
  | 'ordinary-workstation'
  | 'remote-nonsecret'
  | 'remote-secret-replacement'
  | 'high-risk-local-only'
  | 'unsupported-remote';

export const RELAY_SETTINGS_MUTATION_INVENTORY: ReadonlyArray<
  readonly [string, RelaySettingMutationClass]
> = [
  ['appearance.accent', 'ordinary-workstation'],
  ['appearance.accent-schedule', 'ordinary-workstation'],
  ['dynatrace.dashboard', 'ordinary-workstation'],
  ['operator.selection', 'ordinary-workstation'],
  ['dynatrace.environment-url', 'remote-nonsecret'],
  ['dynatrace.platform-token', 'remote-secret-replacement'],
  ['dynatrace.alerting-profiles', 'remote-nonsecret'],
  ['relay.connection', 'high-risk-local-only'],
  ['backup.create', 'high-risk-local-only'],
  ['backup.restore-path', 'high-risk-local-only'],
  ['filesystem.folder-picker', 'unsupported-remote'],
  ['filesystem.executable-picker', 'unsupported-remote'],
];

type DynatraceAdministrationPort = Pick<
  DynatraceProblemsManager,
  'getSettings' | 'saveSettings' | 'saveAlertingProfiles'
>;

type RelayAdministrationServiceOptions = {
  dynatrace: DynatraceAdministrationPort;
};

export class RelaySettingConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('The Relay setting changed. Refresh and try again.');
    this.name = 'RelaySettingConflictError';
  }
}

function configuredSummary(configured: boolean): 'Configured' | 'Not configured' {
  return configured ? 'Configured' : 'Not configured';
}

export class RelayAdministrationService {
  private readonly dynatrace: DynatraceAdministrationPort;
  private readonly revisions = new Map<RelayAdministrableSetting, number>(
    RELAY_ADMINISTRABLE_SETTINGS.map((setting) => [setting, 0]),
  );

  constructor(options: RelayAdministrationServiceOptions) {
    this.dynatrace = options.dynatrace;
  }

  getSettingSummaries(): RelayAdministrationSettingSummary[] {
    const settings = this.dynatrace.getSettings();
    return RELAY_ADMINISTRABLE_SETTINGS.map((setting) => this.summaryFor(setting, settings));
  }

  async replace(
    input: RelayAdministrationSettingReplacePayload,
  ): Promise<RelayAdministrationSettingSummary> {
    const currentRevision = this.revisions.get(input.setting) ?? 0;
    if (input.expectedRevision !== currentRevision) {
      throw new RelaySettingConflictError(currentRevision);
    }

    const settings = await this.applyReplacement(input);
    this.revisions.set(input.setting, currentRevision + 1);
    return this.summaryFor(input.setting, settings);
  }

  private async applyReplacement(
    input: RelayAdministrationSettingReplacePayload,
  ): Promise<DynatraceProblemsPublicSettings> {
    switch (input.setting) {
      case 'dynatrace.environment-url':
        return this.dynatrace.saveSettings({ environmentUrl: input.value.environmentUrl });
      case 'dynatrace.platform-token': {
        const environmentUrl =
          input.value.environmentUrl ?? this.dynatrace.getSettings().environmentUrl;
        if (!environmentUrl) {
          throw new Error('Enter the Dynatrace environment URL with the first platform token.');
        }
        return this.dynatrace.saveSettings({
          environmentUrl,
          apiToken: input.value.apiToken,
        });
      }
      case 'dynatrace.alerting-profiles':
        await this.dynatrace.saveAlertingProfiles(input.value.profiles);
        return this.dynatrace.getSettings();
    }
  }

  private summaryFor(
    setting: RelayAdministrableSetting,
    settings: DynatraceProblemsPublicSettings,
  ): RelayAdministrationSettingSummary {
    const revision = this.revisions.get(setting) ?? 0;
    if (setting === 'dynatrace.environment-url') {
      const configured = Boolean(settings.environmentUrl);
      return {
        setting,
        configured,
        summary: configuredSummary(configured),
        ...(configured ? { valueSummary: settings.environmentUrl } : {}),
        revision,
      };
    }
    if (setting === 'dynatrace.alerting-profiles') {
      const configured = settings.profileFilterConfigured;
      return {
        setting,
        configured,
        summary: configuredSummary(configured),
        ...(configured ? { valueSummary: [...settings.selectedAlertingProfiles] } : {}),
        revision,
      };
    }
    return {
      setting,
      configured: settings.configured,
      summary: configuredSummary(settings.configured),
      revision,
    };
  }
}
