import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MainApp } from '../App';

// ── mock contexts ────────────────────────────────────────────────────────────
vi.mock('../contexts', () => ({
  LocationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NotesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocation: () => null,
}));

// ── mock Toast ───────────────────────────────────────────────────────────────
const mockShowToast = vi.fn();
vi.mock('../components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NoopToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ showToast: mockShowToast }),
}));

// ── mock heavy sub-components ────────────────────────────────────────────────
vi.mock('../components/Sidebar', () => ({
  Sidebar: ({
    activeTab,
    onTabChange,
    onOpenSettings,
  }: {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onOpenSettings: () => void;
  }) => (
    <div data-testid="sidebar">
      <span data-testid="active-tab">{activeTab}</span>
      <button onClick={() => onTabChange('Personnel')}>nav-personnel</button>
      <button onClick={() => onTabChange('People')}>nav-people</button>
      <button onClick={() => onTabChange('Weather')}>nav-weather</button>
      <button onClick={() => onTabChange('Servers')}>nav-servers</button>
      <button onClick={() => onTabChange('Radar')}>nav-radar</button>
      <button onClick={() => onTabChange('AI')}>nav-ai</button>
      <button onClick={onOpenSettings}>open-settings</button>
    </div>
  ),
}));

vi.mock('../components/WorldClock', () => ({
  WorldClock: () => <div data-testid="world-clock" />,
}));

vi.mock('../components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));

vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode; fallback?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('../components/TabFallback', () => ({
  TabFallback: ({ error }: { error?: boolean }) => (
    <div data-testid="tab-fallback">{error ? 'error' : 'loading'}</div>
  ),
}));

vi.mock('../components/CommandPalette', () => ({
  CommandPalette: ({
    isOpen,
    onClose,
    onNavigateToTab,
    onAddContactToBridge,
    onOpenAddContact,
  }: {
    isOpen: boolean;
    onClose: () => void;
    contacts: unknown[];
    servers: unknown[];
    groups: unknown[];
    onAddContactToBridge: (email: string) => void;
    onToggleGroup: (id: string) => void;
    onNavigateToTab: (tab: string) => void;
    onOpenAddContact: (email?: string) => void;
  }) =>
    isOpen ? (
      <div data-testid="command-palette">
        <button onClick={onClose}>close-palette</button>
        <button onClick={() => onNavigateToTab('Personnel')}>go-personnel</button>
        <button onClick={() => onAddContactToBridge('test@example.com')}>add-to-bridge</button>
        <button onClick={() => onOpenAddContact('new@example.com')}>open-add-contact</button>
      </div>
    ) : null,
}));

vi.mock('../components/ShortcutsModal', () => ({
  ShortcutsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="shortcuts-modal">
        <button onClick={onClose}>close-shortcuts</button>
      </div>
    ) : null,
}));

vi.mock('../components/AddContactModal', () => ({
  AddContactModal: ({
    isOpen,
    onClose,
    onSave,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (c: Record<string, unknown>) => void;
    initialEmail?: string;
  }) =>
    isOpen ? (
      <div data-testid="add-contact-modal">
        <button onClick={onClose}>close-add-contact</button>
        <button onClick={() => onSave({ name: 'Test', email: 'test@example.com' })}>
          save-contact
        </button>
      </div>
    ) : null,
}));

// Lazy loaded tabs
vi.mock('../tabs/AssemblerTab', () => ({
  AssemblerTab: () => <div data-testid="assembler-tab" />,
}));

vi.mock('../tabs/DirectoryTab', () => ({
  DirectoryTab: () => <div data-testid="directory-tab" />,
}));

vi.mock('../tabs/ServersTab', () => ({
  ServersTab: () => <div data-testid="servers-tab" />,
}));

vi.mock('../tabs/RadarTab', () => ({
  RadarTab: () => <div data-testid="radar-tab" />,
}));

vi.mock('../tabs/WeatherTab', () => ({
  WeatherTab: () => <div data-testid="weather-tab" />,
}));

vi.mock('../tabs/PersonnelTab', () => ({
  PersonnelTab: () => <div data-testid="personnel-tab" />,
}));

vi.mock('../tabs/AIChatTab', () => ({
  AIChatTab: () => <div data-testid="ai-tab" />,
}));

vi.mock('../components/SettingsModal', () => ({
  SettingsModal: ({
    isOpen,
    onClose,
    onOpenDataManager,
  }: {
    isOpen: boolean;
    onClose: () => void;
    isSyncing: boolean;
    onSync: () => void;
    onOpenDataManager: () => void;
  }) =>
    isOpen ? (
      <div data-testid="settings-modal">
        <button onClick={onClose}>close-settings</button>
        <button onClick={onOpenDataManager}>open-data-manager</button>
      </div>
    ) : null,
}));

vi.mock('../components/DataManagerModal', () => ({
  DataManagerModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="data-manager-modal">
        <button onClick={onClose}>close-data-manager</button>
      </div>
    ) : null,
}));

vi.mock('../components/PopoutBoard', () => ({
  PopoutBoard: () => <div data-testid="popout-board" />,
}));

// ── mock app hooks ───────────────────────────────────────────────────────────
const mockHandleSync = vi.fn();
vi.mock('../hooks/useAppData', () => ({
  useAppData: () => ({
    data: { contacts: [], groups: [], servers: [], onCall: [], teamLayout: [] },
    isReloading: false,
    handleSync: mockHandleSync,
  }),
}));

vi.mock('../hooks/useAppWeather', () => ({
  useAppWeather: () => ({
    weatherLocation: null,
    setWeatherLocation: vi.fn(),
    weatherData: null,
    weatherAlerts: [],
    weatherLoading: false,
    fetchWeather: vi.fn(),
  }),
}));

const mockSetActiveTab = vi.fn();
const mockSetSelectedGroupIds = vi.fn();
const mockSetSettingsOpen = vi.fn();
const mockHandleAddToAssembler = vi.fn();
const mockHandleUndoRemove = vi.fn();
const mockHandleReset = vi.fn();
const mockHandleAddManual = vi.fn();
const mockHandleRemoveManual = vi.fn();
const mockHandleToggleGroup = vi.fn();

vi.mock('../hooks/useAppAssembler', () => ({
  useAppAssembler: () => ({
    activeTab: 'Compose',
    setActiveTab: mockSetActiveTab,
    selectedGroupIds: [],
    setSelectedGroupIds: mockSetSelectedGroupIds,
    manualAdds: [],
    setManualAdds: vi.fn(),
    manualRemoves: [],
    settingsOpen: false,
    setSettingsOpen: mockSetSettingsOpen,
    handleAddToAssembler: mockHandleAddToAssembler,
    handleUndoRemove: mockHandleUndoRemove,
    handleReset: mockHandleReset,
    handleAddManual: mockHandleAddManual,
    handleRemoveManual: mockHandleRemoveManual,
    handleToggleGroup: mockHandleToggleGroup,
  }),
}));

vi.mock('../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  },
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function renderApp(searchParams = '') {
  // Stub globalThis.location.search
  Object.defineProperty(globalThis, 'location', {
    value: { search: searchParams },
    writable: true,
  });
  return render(<MainApp />);
}

describe('MainApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
  });

  it('renders the main layout with sidebar and world clock', () => {
    renderApp();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('world-clock')).toBeInTheDocument();
    expect(screen.getByTestId('window-controls')).toBeInTheDocument();
  });

  it('renders the active tab breadcrumb', () => {
    renderApp();
    // activeTab is 'Compose' → breadcrumb shows "Relay / Compose"
    const breadcrumb = screen.getByText(/Relay \//);
    expect(breadcrumb).toBeInTheDocument();
    expect(breadcrumb.closest('.header-breadcrumb')).toBeInTheDocument();
  });

  it('renders AssemblerTab by default (Compose is mounted)', async () => {
    renderApp();
    await vi.waitFor(() => {
      expect(screen.getByTestId('assembler-tab')).toBeInTheDocument();
    });
  });

  it('opens settings modal when sidebar settings button is clicked', () => {
    renderApp();
    fireEvent.click(screen.getByText('open-settings'));
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('opens command palette on Cmd+K keydown', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: 'k', metaKey: true });
    });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('opens settings on Cmd+, keydown', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: ',', metaKey: true });
    });
    expect(mockSetSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('navigates tab on Cmd+1', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '1', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Compose');
  });

  it('navigates tab on Cmd+2', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '2', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('Personnel');
  });

  it('navigates tab on Cmd+7 (AI)', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '7', metaKey: true });
    });
    expect(mockSetActiveTab).toHaveBeenCalledWith('AI');
  });

  it('opens shortcuts modal on Cmd+Shift+?', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '?', metaKey: true, shiftKey: true });
    });
    expect(screen.getByTestId('shortcuts-modal')).toBeInTheDocument();
  });

  it('closes shortcuts modal', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: '?', metaKey: true, shiftKey: true });
    });
    fireEvent.click(screen.getByText('close-shortcuts'));
    expect(screen.queryByTestId('shortcuts-modal')).not.toBeInTheDocument();
  });

  it('navigates to Compose tab and adds contact when CommandPalette add-to-bridge is used', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: 'k', metaKey: true });
    });
    fireEvent.click(screen.getByText('add-to-bridge'));
    expect(mockHandleAddManual).toHaveBeenCalledWith('test@example.com');
    expect(mockSetActiveTab).toHaveBeenCalledWith('Compose');
  });

  it('opens AddContactModal when CommandPalette open-add-contact is used', () => {
    renderApp();
    act(() => {
      fireEvent.keyDown(globalThis, { key: 'k', metaKey: true });
    });
    fireEvent.click(screen.getByText('open-add-contact'));
    expect(screen.getByTestId('add-contact-modal')).toBeInTheDocument();
  });

  it('shows popout mode when ?popout search param is present', () => {
    renderApp('?popout=board');
    expect(screen.getByText('RELAY ON-CALL BOARD')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });
});

// ── App default export (popout toast branch) ─────────────────────────────────
describe('App default export', () => {
  it('renders without crashing', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: { search: '' },
      writable: true,
    });
    const { default: App } = await import('../App');
    expect(() => render(<App />)).not.toThrow();
  });
});
