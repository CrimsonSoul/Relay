# Design Handoff: Data Persistence & Management

## Context
This document describes the implementation of **Data Persistence** features in Relay. The goal is to allow users to manage contacts, groups, servers, and on-call schedules directly within the application.

## Architecture

### 1. Data Source
- **Format:** CSV (`contacts.csv`, `groups.csv`, `servers.csv`, `oncall.csv`) and JSON (`history.json`).
- **Location:**
  - **Default:** `AppData/Roaming/Relay/data` (Windows/Linux) or `Library/Application Support/Relay/data` (macOS).
  - **Config:** Stored in `config.json` in the user data directory.
  - **Hot-Swapping:** Changing the folder immediately updates the app state without a restart.

### 2. Main Process (`src/main`)
- **`FileManager.ts`**: The core logic class.
  - **Read:** Uses `csv-parse` to read CSVs.
  - **Write:** Uses `csv-stringify` to append or modify CSVs.
  - **Watch:** Uses `chokidar` to watch file changes and emit `IPC_CHANNELS.DATA_UPDATED` to the renderer.
  - **Backup:** Automatic daily backups with 30-day retention.
- **Operations modules (`src/main/operations`)**: Modular CRUD operations for contacts, groups, servers, and on-call data.
- **Handlers (`src/main/handlers`)**: IPC handlers organized by domain (config, data, file, location, weather, window, auth).

### 3. Renderer Process (`src/renderer`)
- **`App.tsx`**: Main application component managing global state and tab routing.
- **Tabs:**
  - **Compose (AssemblerTab)**: Group selection and distribution list assembly
  - **Personnel (PersonnelTab)**: On-call schedule board with drag-and-drop
  - **People (DirectoryTab)**: Contact management with group membership
  - **Servers (ServersTab)**: Server inventory management
  - **Weather (WeatherTab)**: Weather data and alerts
  - **Radar (RadarTab)**: NWS radar viewer
  - **AI (AIChatTab)**: AI assistant integration

## Current State

### ✅ Completed
- **Change Data Folder:** Users can switch folders; data hot-reloads.
- **Contact Management:** Add, remove, search contacts.
- **Group Management:** Create, rename, remove groups; toggle membership.
- **Server Management:** Add, remove, search servers.
- **On-Call Management:** Full team CRUD with drag-and-drop reordering.
- **Import:** Merge external CSVs with column mapping.
- **Backup:** Automatic daily backups with pruning.
- **Weather Integration:** Location-based weather with alerts.
- **Window Controls:** Custom titlebar for Windows.
- **Authentication:** Credential caching for proxy auth.

## Key Files
- `src/main/FileManager.ts`: Core persistence logic
- `src/main/operations/`: Modular CRUD operations
- `src/main/handlers/`: IPC handler modules
- `src/shared/ipc.ts`: Type definitions and IPC channels
- `src/renderer/src/tabs/`: Tab components
- `src/renderer/src/hooks/`: React hooks for data management

## API Reference (IPC)
See `src/shared/ipc.ts` for the complete `BridgeAPI` type definition and `IPC_CHANNELS` constants.
