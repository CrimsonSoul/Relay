import { Page } from '@playwright/test';
import { AppData, BridgeAPI, RadarSnapshot } from '../../src/shared/ipc';

export const MOCK_DATA: AppData = {
  groups: {
    'Alpha Team': ['alpha1@agency.net', 'alpha2@agency.net'],
    'Beta Squad': ['beta1@agency.net']
  },
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
    const mockApi: BridgeAPI = {
      openPath: async () => {},
      openExternal: async () => {},
      openGroupsFile: async () => {},
      openContactsFile: async () => {},
      importGroupsFile: async () => true,
      importContactsFile: async () => true,
      importServersFile: async () => true,
      subscribeToData: (callback) => {
        // Immediately callback with data
        callback(data.mockData);
        return () => {};
      },
      onReloadStart: (callback) => {
        (globalThis as any).__triggerReloadStart = callback;
        return () => {};
      },
      onReloadComplete: (callback) => {
        (globalThis as any).__triggerReloadComplete = callback;
        return () => {};
      },
      onDataError: (callback) => {
        return () => {};
      },
      reloadData: async () => {
        // Simulate a reload cycle
        if ((globalThis as any).__triggerReloadStart) (globalThis as any).__triggerReloadStart();
        setTimeout(() => {
            if ((globalThis as any).__triggerReloadComplete) (globalThis as any).__triggerReloadComplete(true);
        }, 500);
      },
      onAuthRequested: () => () => {},
      submitAuth: async (nonce, username, password, remember) => true,
      cancelAuth: () => {},
      subscribeToRadar: (callback) => {
         callback(data.mockRadar);
         return () => {};
      },
      logBridge: () => {},
      addContact: async () => true,
      removeContact: async () => true,
      addServer: async () => true,
      removeServer: async () => true,
      addGroup: async () => true,
      addContactToGroup: async () => true,
      removeContactFromGroup: async () => true,
      importContactsWithMapping: async () => true,
      changeDataFolder: async () => true,
      resetDataFolder: async () => true,
      getDataPath: async () => '/mock/data/path',
      removeGroup: async () => true,
      renameGroup: async () => true,
      windowMinimize: () => {},
      windowMaximize: () => {},
      windowClose: () => {}
    };

    // Expose it as window.api
    (globalThis as any).api = mockApi;
  }, { mockData: MOCK_DATA, mockRadar: MOCK_RADAR });
}
