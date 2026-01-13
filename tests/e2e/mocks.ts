import { Page } from '@playwright/test';
import { AppData, BridgeAPI, RadarSnapshot, BridgeGroup } from '../../src/shared/ipc';

export const MOCK_GROUPS: BridgeGroup[] = [
  {
    id: 'group_1',
    name: 'Alpha Team',
    contacts: ['alpha1@agency.net', 'alpha2@agency.net'],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'group_2',
    name: 'Beta Squad',
    contacts: ['beta1@agency.net'],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

export const MOCK_DATA: AppData = {
  groups: MOCK_GROUPS,
  contacts: [
    {
      name: 'John Doe',
      email: 'john.doe@agency.net',
      phone: '555-0100',
      title: 'Officer',
      _searchString: 'john doe officer',
      raw: {}
    },
    {
      name: 'Jane Smith',
      email: 'jane.smith@agency.net',
      phone: '555-0101',
      title: 'Analyst',
      _searchString: 'jane smith analyst',
      raw: {}
    }
  ],
  servers: [],
  onCall: [],
  lastUpdated: Date.now()
};

export const MOCK_RADAR: RadarSnapshot = {
  counters: { ok: 5, pending: 2, internalError: 0 },
  statusVariant: 'success',
  statusText: 'All Systems Operational',
  lastUpdated: Date.now()
};

export async function injectMockApi(page: Page) {
  await page.addInitScript((data) => {
    // Create the mock API object
    const mockApi: Partial<BridgeAPI> = {
      openPath: async () => {},
      openExternal: async () => {},
      openContactsFile: async () => {},
      importGroupsFromCsv: async () => true,
      importContactsFile: async () => true,
      importServersFile: async () => true,
      subscribeToData: (callback) => {
        // Immediately callback with data
        callback(data.mockData);
        return () => {};
      },
      onReloadStart: (callback) => {
        (globalThis as Record<string, unknown>).__triggerReloadStart = callback;
        return () => {};
      },
      onReloadComplete: (callback) => {
        (globalThis as Record<string, unknown>).__triggerReloadComplete = callback;
        return () => {};
      },
      onDataError: (_callback) => {
        return () => {};
      },
      onImportProgress: (_callback) => {
        return () => {};
      },
      reloadData: async () => {
        // Simulate a reload cycle
        if ((globalThis as Record<string, unknown>).__triggerReloadStart) (globalThis as Record<string, unknown>).__triggerReloadStart();
        setTimeout(() => {
            if ((globalThis as Record<string, unknown>).__triggerReloadComplete) (globalThis as Record<string, unknown>).__triggerReloadComplete(true);
        }, 500);
      },
      onAuthRequested: () => () => {},
      submitAuth: async (_nonce, _username, _password, _remember) => true,
      cancelAuth: () => {},
      useCachedAuth: async () => true,
      subscribeToRadar: (callback) => {
         callback(data.mockRadar);
         return () => {};
      },
      logBridge: () => {},
      addContact: async () => true,
      removeContact: async () => true,
      addServer: async () => true,
      removeServer: async () => true,
      importContactsWithMapping: async () => true,
      changeDataFolder: async () => true,
      resetDataFolder: async () => true,
      getDataPath: async () => '/mock/data/path',
      windowMinimize: () => {},
      windowMaximize: () => {},
      windowClose: () => {},
      isMaximized: async () => false,
      onMaximizeChange: () => {},
      removeMaximizeListener: () => {},
      generateDummyData: async () => true,
      getIpLocation: async () => null,
      logToMain: () => {},
      getWeather: async () => null,
      searchLocation: async () => [],
      getWeatherAlerts: async () => [],
      updateOnCallTeam: async () => true,
      removeOnCallTeam: async () => true,
      renameOnCallTeam: async () => true,
      saveAllOnCall: async () => true,
      // New Groups API
      getGroups: async () => data.mockData.groups,
      saveGroup: async () => ({ id: 'new_group', name: 'New Group', contacts: [], createdAt: Date.now(), updatedAt: Date.now() }),
      updateGroup: async () => true,
      deleteGroup: async () => true,
      // Bridge History API
      getBridgeHistory: async () => [],
      addBridgeHistory: async () => ({ id: 'history_1', timestamp: Date.now(), note: '', groups: [], contacts: [], recipientCount: 0 }),
      deleteBridgeHistory: async () => true,
      clearBridgeHistory: async () => true,
      // Notes API
      getNotes: async () => ({ contacts: {}, servers: {} }),
      setContactNote: async () => true,
      setServerNote: async () => true,
      // Saved Locations API
      getSavedLocations: async () => [],
      saveLocation: async () => ({ id: 'loc_1', name: 'Test Location', lat: 0, lon: 0, isDefault: false }),
      deleteLocation: async () => true,
      setDefaultLocation: async () => true,
      clearDefaultLocation: async () => true,
      updateLocation: async () => true,
      // Data Manager API
      exportData: async () => true,
      importData: async () => ({ success: true, imported: 0, updated: 0, skipped: 0, errors: [] }),
      getDataStats: async () => ({ contacts: { count: 0, lastUpdated: 0 }, servers: { count: 0, lastUpdated: 0 }, oncall: { count: 0, lastUpdated: 0 }, groups: { count: 0, lastUpdated: 0 }, hasCsvFiles: false }),
      migrateFromCsv: async () => ({ success: true, contacts: { migrated: 0, errors: [] }, servers: { migrated: 0, errors: [] }, oncall: { migrated: 0, errors: [] } }),
      // Contact Records API
      getContacts: async () => [],
      addContactRecord: async () => null,
      updateContactRecord: async () => true,
      deleteContactRecord: async () => true,
      // Server Records API
      getServers: async () => [],
      addServerRecord: async () => null,
      updateServerRecord: async () => true,
      deleteServerRecord: async () => true,
      // OnCall Records API
      getOnCall: async () => [],
      addOnCallRecord: async () => null,
      updateOnCallRecord: async () => true,
      deleteOnCallRecord: async () => true,
      deleteOnCallByTeam: async () => true,
      // Clipboard API
      writeClipboard: async () => true
    };

    // Expose it as window.api
    (globalThis as Record<string, unknown>).api = mockApi;
  }, { mockData: MOCK_DATA, mockRadar: MOCK_RADAR });
}
