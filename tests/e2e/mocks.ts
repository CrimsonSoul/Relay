/* eslint-disable no-undef */
import { Page } from '@playwright/test';
import { AppData, BridgeAPI, RadarSnapshot, BridgeGroup, Contact, Server, WeatherData, WeatherAlert, ContactRecord, ServerRecord, OnCallRecord } from '../../src/shared/ipc';

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

export type MockOverrides = {
  mockData?: Partial<AppData>;
  mockRadar?: Partial<RadarSnapshot>;
  mockWeather?: WeatherData;
  mockAlerts?: WeatherAlert[];
};

export async function injectMockApi(page: Page, overrides: MockOverrides = {}) {
  // Mock geolocation before anything else
  await page.addInitScript(() => {
    const mockGeolocation = {
      getCurrentPosition: (success: PositionCallback) => {
        setTimeout(() => {
          success({
            coords: {
              latitude: 40.7128,
              longitude: -74.0060,
              accuracy: 100,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 100);
      },
      watchPosition: (success: PositionCallback) => {
        const id = Math.floor(Math.random() * 1000);
        setTimeout(() => {
          success({
            coords: {
              latitude: 40.7128,
              longitude: -74.0060,
              accuracy: 100,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 100);
        return id;
      },
      clearWatch: () => {},
    };
    (navigator as unknown as { geolocation: unknown }).geolocation = mockGeolocation;
  });

  await page.addInitScript((args) => {
    const { mockData, mockRadar, mockWeather, mockAlerts } = args;
    
    // Stateful data container
    const currentData: AppData = JSON.parse(JSON.stringify(mockData));
    
    let dataCallback: ((data: AppData) => void) | null = null;
    let _radarCallback: ((data: RadarSnapshot) => void) | null = null;

    const broadcast = () => {
      console.log('[Mock API] Broadcasting data update', currentData);
      currentData.lastUpdated = Date.now();
      if (dataCallback) {
          dataCallback(JSON.parse(JSON.stringify(currentData)));
      }
    };

    // Create the mock API object
    const mockApi: Partial<BridgeAPI> = {
      openPath: async () => {},
      openExternal: async () => {},
      openContactsFile: async () => {},
      importGroupsFromCsv: async () => ({ success: true }),
      importContactsFile: async () => ({ success: true }),
      importServersFile: async () => ({ success: true }),
      
      subscribeToData: (callback) => {
        dataCallback = callback;
        callback(JSON.parse(JSON.stringify(currentData)));
        return () => { dataCallback = null; };
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
        if ((globalThis as Record<string, unknown>).__triggerReloadStart) (globalThis as Record<string, unknown>).__triggerReloadStart();
        setTimeout(() => {
            if ((globalThis as Record<string, unknown>).__triggerReloadComplete) (globalThis as Record<string, unknown>).__triggerReloadComplete(true);
        }, 500);
      },
      onAuthRequested: () => () => {},
      submitAuth: async () => true,
      cancelAuth: () => {},
      useCachedAuth: async () => true,
      
      subscribeToRadar: (callback) => {
         _radarCallback = callback;
         callback(mockRadar);
         return () => { _radarCallback = null; };
      },
      
      logBridge: () => {},
      
      addContact: async (contact) => {
         const newContact = {
             ...contact,
             _searchString: ((contact.name || '') + ' ' + (contact.email || '')).toLowerCase(),
             raw: {}
         } as Contact;
         currentData.contacts.push(newContact);
         broadcast();
         return { success: true };
      },
      
      removeContact: async (email) => {
         currentData.contacts = currentData.contacts.filter(c => c.email !== email);
         broadcast();
         return { success: true };
      },
      
      addServer: async (server) => {
         const newServer = {
             ...server,
             _searchString: ((server.name || '') + ' ' + (server.os || '')).toLowerCase(),
             raw: {}
         } as Server;
         currentData.servers.push(newServer);
         broadcast();
         return { success: true };
      },
      
      removeServer: async (name) => {
         currentData.servers = currentData.servers.filter(s => s.name !== name);
         broadcast();
         return { success: true };
      },
      
      importContactsWithMapping: async () => ({ success: true }),
      changeDataFolder: async () => true,
      resetDataFolder: async () => true,
      getDataPath: async () => '/mock/data/path',
      windowMinimize: () => {},
      windowMaximize: () => {},
      windowClose: () => {},
      isMaximized: async () => false,
      onMaximizeChange: () => {},
      removeMaximizeListener: () => {},
      generateDummyData: async () => ({ success: true }),
      getIpLocation: async () => ({
          lat: 40.7128,
          lon: -74.0060,
          city: 'New York',
          region: 'NY',
          country: 'USA'
      }),
      logToMain: () => {},
      
      getWeather: async () => mockWeather,
      getWeatherAlerts: async () => mockAlerts || [],
      
      searchLocation: async () => ({ results: [] }),
      updateOnCallTeam: async () => ({ success: true }),
      removeOnCallTeam: async () => ({ success: true }),
      renameOnCallTeam: async () => ({ success: true }),
      reorderOnCallTeams: async () => ({ success: true }),
      saveAllOnCall: async () => ({ success: true }),
      getGroups: async () => currentData.groups,
      saveGroup: async () => ({ success: true, data: { id: 'new_group', name: 'New Group', contacts: [], createdAt: Date.now(), updatedAt: Date.now() } }),
      updateGroup: async () => ({ success: true }),
      deleteGroup: async () => ({ success: true }),
      getBridgeHistory: async () => [],
      addBridgeHistory: async () => ({ success: true, data: { id: 'history_1', timestamp: Date.now(), note: '', groups: [], contacts: [], recipientCount: 0 } }),
      deleteBridgeHistory: async () => ({ success: true }),
      clearBridgeHistory: async () => ({ success: true }),
      getNotes: async () => ({ contacts: {}, servers: {} }),
      setContactNote: async () => ({ success: true }),
      setServerNote: async () => ({ success: true }),
      getSavedLocations: async () => [],
      saveLocation: async () => ({ success: true, data: { id: 'loc_1', name: 'Test Location', lat: 0, lon: 0, isDefault: false } }),
      deleteLocation: async () => ({ success: true }),
      setDefaultLocation: async () => ({ success: true }),
      clearDefaultLocation: async () => ({ success: true }),
      updateLocation: async () => ({ success: true }),
      exportData: async () => ({ success: true }),
      importData: async () => ({ success: true, data: { success: true, imported: 0, updated: 0, skipped: 0, errors: [] } }),
      getDataStats: async () => ({ contacts: { count: 0, lastUpdated: 0 }, servers: { count: 0, lastUpdated: 0 }, oncall: { count: 0, lastUpdated: 0 }, groups: { count: 0, lastUpdated: 0 }, hasCsvFiles: false }),
      migrateFromCsv: async () => ({ success: true, data: { success: true, contacts: { migrated: 0, errors: [] }, servers: { migrated: 0, errors: [] }, oncall: { migrated: 0, errors: [] }, groups: { migrated: 0, errors: [] } } }),
      getContacts: async () => [],
      addContactRecord: async () => ({ success: true, data: null as unknown as ContactRecord }),
      updateContactRecord: async () => ({ success: true }),
      deleteContactRecord: async () => ({ success: true }),
      getServers: async () => [],
      addServerRecord: async () => ({ success: true, data: null as unknown as ServerRecord }),
      updateServerRecord: async () => ({ success: true }),
      deleteServerRecord: async () => ({ success: true }),
      getOnCall: async () => [],
      addOnCallRecord: async () => ({ success: true, data: null as unknown as OnCallRecord }),
      updateOnCallRecord: async () => ({ success: true }),
      deleteOnCallRecord: async () => ({ success: true }),
      deleteOnCallByTeam: async () => ({ success: true }),
      writeClipboard: async () => true
    };

    (globalThis as Record<string, unknown>).api = mockApi;
  }, { 
    mockData: { ...MOCK_DATA, ...overrides.mockData }, 
    mockRadar: { ...MOCK_RADAR, ...overrides.mockRadar },
    mockWeather: overrides.mockWeather ?? null,
    mockAlerts: overrides.mockAlerts ?? []
  });
}
