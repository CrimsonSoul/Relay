export type RelayRuntimeKind = 'electron' | 'web';

export type RelayRuntimeCapabilities = {
  connectionConfiguration: boolean;
  pocketBaseRecovery: boolean;
  offlineCache: boolean;
  offlineMutations: boolean;
  nativeWindowControls: boolean;
  customReminderSound: boolean;
  imageClipboard: boolean;
  privilegedAccess: boolean;
  knowledgePublishing: boolean;
};

export type RelayRuntimeDescriptor = {
  kind: RelayRuntimeKind;
  label: 'Desktop' | 'Web';
  capabilities: Readonly<RelayRuntimeCapabilities>;
};

const ELECTRON_CAPABILITIES = Object.freeze<RelayRuntimeCapabilities>({
  connectionConfiguration: true,
  pocketBaseRecovery: true,
  offlineCache: true,
  offlineMutations: true,
  nativeWindowControls: true,
  customReminderSound: true,
  imageClipboard: true,
  privilegedAccess: true,
  knowledgePublishing: true,
});

const WEB_CAPABILITIES = Object.freeze<RelayRuntimeCapabilities>({
  connectionConfiguration: false,
  pocketBaseRecovery: false,
  offlineCache: false,
  offlineMutations: false,
  nativeWindowControls: false,
  customReminderSound: false,
  imageClipboard: false,
  privilegedAccess: true,
  knowledgePublishing: true,
});

export const ELECTRON_RUNTIME = Object.freeze<RelayRuntimeDescriptor>({
  kind: 'electron',
  label: 'Desktop',
  capabilities: ELECTRON_CAPABILITIES,
});

export const WEB_RUNTIME = Object.freeze<RelayRuntimeDescriptor>({
  kind: 'web',
  label: 'Web',
  capabilities: WEB_CAPABILITIES,
});
