# Relay

Relay is a high-performance desktop application designed for operators to manage on-call schedules, monitor environment data, and leverage AI assistance in a unified, premium interface. Built with **Electron, Vite, and React**, it provides a "Matte Dark" environment that is both visually stunning and functionally robust.

## Core Features

### 📅 On-Call Schedule
- **Dynamic Scheduling**: Manage team rotations with a drag-and-drop grid interface.
- **Auto-Positioning**: Cards automatically size and position themselves for optimal visibility.
- **Smart Reminders**: Contextual alerts (Monday/Wednesday/Friday) ensure schedules are updated on time, with auto-refresh logic that updates even if the app is left running.
- **Persistence**: Layouts and member data are saved locally and synced across sessions.

### 🌤️ Weather & Environmental Monitoring
- **Live Weather Dashboard**: Real-time updates based on auto-detected or manually set locations.
- **Interactive Radar**: Live radar monitoring with specialized fixes for consistent rendering on Windows.
- **Severe Weather Alerts**: Automatic toast notifications for extreme or severe conditions in your area.

### 🤖 AI Chat Tabs
- **Integrated AI Services**: Quick access to Gemini and ChatGPT in a private, sandboxed environment.
- **Secure Sessions**: Data is cleared when you leave the tab, ensuring privacy.
- **Visual Excellence**: Robust SVG masking ensures clean, rounded corners on Windows without visual flickering.

### 🖥️ System & Management
- **Server Monitoring**: Unified view of server health and contact points.
- **Directory Services**: Bridging local contact data with external communication tools like Microsoft Teams.
- **World Clock**: Keep track of global operations at a glance.

## Design Philosophy: "Matte Dark"

Relay prioritized a premium, state-of-the-art aesthetic:
- **Palette**: Deep charcoal background (#141414) with vibrant, harmonious accent colors.
- **Typography**: Optimized with modern fonts (Inter, JetBrains Mono).
- **Interactions**: Smooth micro-animations and tactile feedback (glassmorphism effects).

## Technical Overview

- **Frontend**: React 18, Vite 5, CSS-in-JS (Vanilla CSS).
- **Backend**: Electron Main process with secure IPC communication.
- **Data**: Local-first architecture (JSON/CSV) for speed and privacy.
- **Security**: Strict sandboxing and Context Isolation.

## Getting Started

1. **Install Dependencies**: `npm install`
2. **Launch App**: `npm run dev`
3. **Type Checking**: `npm run typecheck`
4. **Build Production**: `npm run build`

## Project Structure

- `src/main`: Electron backend logic, IPC handlers, and window management.
- `src/renderer`: React frontend components and tabs.
- `src/preload`: Secure bridge for exposing APIs to the UI.
- `src/shared`: TypeScript types and shared utility functions.
