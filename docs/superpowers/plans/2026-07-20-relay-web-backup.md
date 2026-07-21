# Relay Web Backup Implementation Plan

> **For agentic workers:** Execute this plan directly in the primary current session. Use red-green TDD for every behavior slice and one independent final review after implementation; do not dispatch per-task implementers or reviewers unless the user asks.

**Goal:** Add a trusted-LAN/VPN browser backup for Relay with near-full desktop parity, isolated ordinary and privileged sessions, browser-based Knowledge publishing, and the existing outage-only notification policy, without changing existing Electron client transport or offline behavior.

**Architecture:** Keep the React renderer and PocketBase collection/realtime data path shared. Electron continues to use the context-isolated preload and trusted IPC handlers. The same renderer bundle installs a capability-aware web bridge when no preload is present; that bridge uses browser primitives, direct authenticated PocketBase access for ordinary data, and a versioned same-origin HTTP/SSE gateway for main-process services. A server-mode `RelayWebServer` owns gateway lifecycle, static assets, sessions, request security, per-session privileged runtimes, and browser upload staging.

**Tech Stack:** TypeScript 6, React 19, Electron 42, Vite 7, PocketBase SDK 0.26, Node HTTP, Zod 4, Vitest 4, Testing Library, Playwright Chromium/WebKit

## Global Constraints

- Preserve the existing Electron preload, IPC channel behavior, trusted-sender checks, PocketBase URLs, client pairing, offline cache, pending mutations, and reconnect replay.
- Start Relay Web only from an explicitly enabled server-mode desktop app, after PocketBase is healthy; default the dedicated port to `8091` and never select a different port silently.
- Bind only to the configured trusted LAN/VPN interface. Reject public remote addresses, invalid Host/Origin values, permissive CORS, and loopback-only enablement.
- Serve HTTP only because certificate installation is unavailable. Always show `Trusted LAN/VPN only - browser traffic is not encrypted`; never imply confidentiality, integrity, server authentication, or HTTPS-equivalent protection.
- Support current stable desktop Chrome, Edge, and Safari at 1024 by 768 and larger. Show a dedicated larger-window-required state below 1024 CSS pixels; do not add a phone layout.
- Keep the browser online-only. It may retain stale visible state while disconnected, but it must disable writes and must never read/write Electron's offline cache or queue mutations.
- Keep the connection passphrase, privileged credentials, role tokens, signing material, approval codes, and CSRF material out of logs and persistent browser storage.
- Ordinary browser sessions are server-held, nonpersistent, 60-minute idle and eight-hour absolute. Privileged sessions remain isolated per browser session and retain the existing 15-minute inactivity lock.
- Keep initial Relay server setup/connection reconfiguration, PocketBase backup/restore, and destructive reset desktop-only. Ordinary data import/export remains available in the browser.
- Keep all authorized administration, paired-device management, protected credential changes, Dynatrace configuration, Knowledge reading/search/publishing/management, and in-app notifications available in the browser.
- Preserve notification behavior already on `test`: every newly opened Dynatrace Problem uses the priority lane; provider status toasts are current outage-only and limited by the seven-day freshness rule. Do not add Notification API, push, service workers, or closed-tab delivery.
- Use exact allowlisted routes and typed schemas. Do not add a generic IPC-over-HTTP dispatcher.
- Run the focused test command after every slice. After Slice 8, run the complete unit, cache, renderer, Electron, browser, type, lint, format, and production-build gates from a clean process state.

## Runtime and Security Contracts

The implementation should converge on these shared public shapes rather than branching on ad hoc browser globals:

```ts
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
  capabilities: RelayRuntimeCapabilities;
};
```

The web gateway owns `/relay-api/v1/*`. Every request/result lives in `src/shared/webApi.ts`, is parsed at the gateway, and is normalized again at the web bridge before reaching React.

---

## Slice 1: Shared Runtime Contract and Dual Bootstrap

**Files:**

- Create: `src/shared/runtime.ts`
- Create: `src/shared/webApi.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Test: `src/preload/index.test.ts`
- Create: `src/renderer/src/runtime/relayRuntime.ts`
- Create: `src/renderer/src/runtime/WebSessionGate.tsx`
- Create: `src/renderer/src/runtime/WebSessionGate.test.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/vite-env.d.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `vite.renderer.config.ts`
- Modify: `electron.vite.config.ts`

**Interfaces:**

- Produces: `RelayRuntimeDescriptor`, `RelayRuntimeCapabilities`, `ELECTRON_RUNTIME`, and `WEB_RUNTIME`.
- Extends: `BridgeAPI` with readonly `runtime` while preserving every existing method and `platform` value.
- Produces: `getRelayRuntime()` and `hasRelayCapability()` as the only renderer capability checks.
- Produces: typed web session bootstrap/login/logout request and result schemas, ready for Slice 3.
- Preserves: Electron startup renders immediately through the preload; a plain browser renders `WebSessionGate` before importing the authenticated app shell.

- [ ] **Step 1: Write failing runtime and bootstrap tests**

Add preload expectations for the complete Electron descriptor and renderer tests that assert:

```ts
expect(globalThis.api?.runtime).toEqual(ELECTRON_RUNTIME);
expect(hasRelayCapability('offlineMutations')).toBe(true);
```

For a missing preload, require `WebSessionGate` to render an initializing state without importing `App`. For a mocked authenticated web bootstrap, require it to install exactly one `BridgeAPI`, then render the shared app. Assert a failed bootstrap renders the web sign-in slot rather than `SetupScreen`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/preload/index.test.ts \
  src/renderer/src/runtime/WebSessionGate.test.tsx \
  src/renderer/src/__tests__/App.test.tsx
```

Expected: FAIL because the runtime descriptor, web gate, and capability accessors do not exist.

- [ ] **Step 3: Implement the dual bootstrap contract**

Add frozen runtime descriptors. Electron capabilities are all true; web capabilities are true except connection configuration, PocketBase recovery, offline cache/mutations, native window controls, custom reminder sound, and image clipboard.

Expose `runtime: ELECTRON_RUNTIME` from preload. In `main.tsx`, keep the preload path synchronous; when no preload exists, render `WebSessionGate`, which owns only session bootstrap and installs the eventual web bridge before dynamically loading `App`. Keep auth/session state out of `AppWithSetup` so Electron setup behavior remains unchanged.

Make `AppWithSetup` capability-aware: a web `not-configured` result must return to `WebSessionGate`, never server setup. Do not implement gateway requests yet; use an injected `WebSessionClient` port so this slice remains testable.

Configure the standalone Vite build to emit the same hashed renderer assets and relative asset URLs that both `file://` Electron and the future HTTP static server can load. Keep the Electron production CSP fallback unchanged; HTTP headers become authoritative in Slice 3.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run build:renderer
npm run typecheck
```

Expected: all commands PASS; the production renderer contains one shared app bundle and no second UI source tree.

- [ ] **Step 5: Commit the runtime contract**

```bash
git add src/shared/runtime.ts src/shared/webApi.ts src/shared/ipc.ts \
  src/preload/index.ts src/preload/index.test.ts \
  src/renderer/src/runtime src/renderer/src/main.tsx \
  src/renderer/src/vite-env.d.ts src/renderer/src/App.tsx \
  src/renderer/src/__tests__/App.test.tsx vite.renderer.config.ts electron.vite.config.ts
git commit -m "feat(web): add shared runtime bootstrap"
```

---

## Slice 2: Server Configuration, Static Gateway, and Lifecycle

**Files:**

- Modify: `src/main/config/AppConfig.ts`
- Test: `src/main/config/AppConfig.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Test: `src/shared/ipcValidation.test.ts`
- Create: `src/main/web/privateNetwork.ts`
- Create: `src/main/web/privateNetwork.test.ts`
- Create: `src/main/web/RelayWebServer.ts`
- Create: `src/main/web/RelayWebServer.test.ts`
- Create: `src/main/web/RelayWebServerState.ts`
- Modify: `src/main/app/appState.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Test: `src/main/app/__tests__/runtimeReconfigure.test.ts`
- Modify: `src/main/handlers/setupHandlers.ts`
- Test: `src/main/handlers/setupHandlers.test.ts`
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Test: `src/renderer/src/components/__tests__/SettingsModal.test.tsx`
- Modify: `src/renderer/src/styles/modals.css`
- Modify: `electron-builder.yml`

**Interfaces:**

- Extends: server configuration with `web: { enabled: boolean; port: number }`, migrated to `{ enabled: false, port: 8091 }` for existing configs.
- Produces: `RelayWebServerState = 'disabled' | 'starting' | 'available' | 'conflict' | 'failed'` plus bounded public detail and exact URL.
- Produces: trusted IPC operations `getWebServerState`, `saveWebServerConfig`, and `retryWebServer`.
- Produces: `RelayWebServer.start()`, `.stop()`, `.retry()`, and `.getState()`.
- Preserves: PocketBase remains usable if the web port is occupied or the gateway fails.

- [ ] **Step 1: Write failing configuration, network, lifecycle, and Settings tests**

Require legacy server config loading to add disabled web defaults without rewriting the file until the next save. Reject a web port below 1024, above 65535, equal to the PocketBase port, or enabled with `bindHost: '127.0.0.1'`.

Table-test `privateNetwork.ts` for loopback, RFC1918 IPv4, IPv4-mapped IPv6, link-local, ULA IPv6, recognized local interface addresses, and public addresses. Require public addresses to fail closed.

Use an ephemeral test port to require `RelayWebServer` to:

- serve `index.html` and hashed assets with correct MIME types and traversal protection;
- return the app shell for a valid non-API route;
- bind the requested address and exact port only;
- report `conflict` on `EADDRINUSE` without retrying another port;
- keep repeated start/stop calls idempotent; and
- remove listeners and temporary resources before resolving `stop()`.

In Settings, assert the disabled toggle, validated port, exact LAN URL, copy action, retry state, and warning text. Assert the controls are absent for client mode.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/main/config/AppConfig.test.ts \
  src/shared/ipcValidation.test.ts \
  src/main/web/privateNetwork.test.ts \
  src/main/web/RelayWebServer.test.ts \
  src/main/app/__tests__/runtimeReconfigure.test.ts \
  src/main/handlers/setupHandlers.test.ts \
  src/renderer/src/components/__tests__/SettingsModal.test.tsx
```

Expected: FAIL because web configuration and gateway lifecycle do not exist.

- [ ] **Step 3: Implement configuration and lifecycle**

Persist web settings inside the existing encrypted/atomic `AppConfig` file. Keep the connection passphrase handling unchanged. Return only public web fields and runtime state through IPC.

Implement `RelayWebServer` with Node's HTTP server and an injected route handler/static root. Resolve the packaged static root from `dist/renderer`; resolve the development root explicitly for tests/dev. Canonicalize paths, reject encoded traversal and dot segments, serve only files beneath the renderer root, and fall back to `index.html` only for non-API GET/HEAD navigation.

Start the gateway after successful `startPocketBase()` and server-only managers. Stop it before privileged services and PocketBase on shutdown, restart, config change, or mode change. A web failure updates public state and logs a bounded error but returns success for the underlying PocketBase startup.

In server Settings, use the existing dense Relay form language: toggle, numeric port, status indicator, URL, copy button, retry button, and permanent HTTP warning. Do not add setup, QR, DNS, or automatic-port UI. Include `dist/renderer/**` in packaged files once and do not introduce a separately packaged site.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run build
npm run typecheck
```

Expected: all commands PASS. With web disabled, no listener opens. With an occupied web port, Electron/PocketBase stay operational and Settings reports a conflict.

- [ ] **Step 5: Commit the gateway lifecycle**

```bash
git add src/main/config src/shared/ipc.ts src/shared/ipcValidation.ts \
  src/shared/ipcValidation.test.ts src/main/web src/main/app/appState.ts \
  src/main/index.ts src/main/app/runtimeReconfigure.ts \
  src/main/app/__tests__/runtimeReconfigure.test.ts \
  src/main/handlers/setupHandlers.ts src/main/handlers/setupHandlers.test.ts \
  src/renderer/src/components/SettingsModal.tsx \
  src/renderer/src/components/__tests__/SettingsModal.test.tsx \
  src/renderer/src/styles/modals.css electron-builder.yml
git commit -m "feat(web): host Relay from server mode"
```

---

## Slice 3: Ordinary Web Authentication and HTTP Security Boundary

**Files:**

- Modify: `src/shared/webApi.ts`
- Create: `src/shared/webApi.test.ts`
- Create: `src/main/web/WebSessionStore.ts`
- Create: `src/main/web/WebSessionStore.test.ts`
- Create: `src/main/web/WebRequestSecurity.ts`
- Create: `src/main/web/WebRequestSecurity.test.ts`
- Create: `src/main/web/WebRateLimiter.ts`
- Create: `src/main/web/WebRateLimiter.test.ts`
- Create: `src/main/web/WebRouter.ts`
- Create: `src/main/web/WebRouter.test.ts`
- Create: `src/main/web/routes/sessionRoutes.ts`
- Create: `src/main/web/routes/sessionRoutes.test.ts`
- Modify: `src/main/web/RelayWebServer.ts`
- Modify: `src/main/handlers/pocketbaseConnectionHandlers.ts`
- Test: `src/main/handlers/pocketbaseConnectionHandlers.test.ts`
- Create: `src/renderer/src/runtime/WebSessionClient.ts`
- Create: `src/renderer/src/runtime/WebSessionClient.test.ts`
- Modify: `src/renderer/src/runtime/WebSessionGate.tsx`
- Modify: `src/renderer/src/runtime/WebSessionGate.test.tsx`
- Create: `src/renderer/src/components/WebLoginScreen.tsx`
- Create: `src/renderer/src/components/__tests__/WebLoginScreen.test.tsx`
- Modify: `src/renderer/src/styles/setup.css`

**Interfaces:**

- Produces: `POST /relay-api/v1/session/login`, `GET /session/bootstrap`, `POST /session/refresh`, `POST /session/logout`, and `GET /session/events`.
- Produces: opaque 256-bit session IDs in nonpersistent `HttpOnly; SameSite=Strict; Path=/relay-api` cookies.
- Produces: in-memory CSRF token returned by bootstrap and required in `X-Relay-CSRF` on every state-changing authenticated route.
- Produces: server-held PocketBase app-user auth store and bounded browser bootstrap `{ pbUrl, auth, publicConfig, csrf, runtime }`.
- Preserves: the passphrase is used only for login authentication and is never retained by `WebSessionStore`.

- [ ] **Step 1: Write failing session and request-security tests**

Use fake clocks and deterministic random bytes to cover login rotation, bootstrap, refresh, logout, 60-minute idle expiry, eight-hour absolute expiry, server-restart invalidation, and cleanup callbacks. Assert session IDs, CSRF values, PocketBase tokens, and passphrases never appear in public errors or captured logs.

Table-test the HTTP boundary:

- exact Host allowlist accepts current hostname/private interface plus configured port and rejects suffix/prefix tricks;
- the interface allowlist refreshes once before rejecting an otherwise private Host;
- only private/loopback/link-local/approved VPN remote addresses pass;
- authenticated requests require exact same-origin `Origin` where the method supplies one;
- cross-origin and `Origin: null` state changes fail;
- no route emits permissive CORS;
- login, refresh, privileged, approval, and upload buckets are separately bounded by IP/session;
- oversized headers/body, invalid content types, malformed JSON, unsupported methods, and unknown routes fail with bounded responses;
- authenticated HTML/API responses use `Cache-Control: no-store`;
- all responses carry CSP, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and strict referrer policy.

For session routes, assert generic invalid-login copy, constant response shape, path-scoped cookie, no `Secure` attribute on accepted HTTP, token rotation on login/refresh, SSE heartbeat/close cleanup, and complete session disposal on logout.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/shared/webApi.test.ts \
  src/main/web/WebSessionStore.test.ts \
  src/main/web/WebRequestSecurity.test.ts \
  src/main/web/WebRateLimiter.test.ts \
  src/main/web/WebRouter.test.ts \
  src/main/web/routes/sessionRoutes.test.ts \
  src/main/handlers/pocketbaseConnectionHandlers.test.ts \
  src/renderer/src/runtime/WebSessionClient.test.ts \
  src/renderer/src/runtime/WebSessionGate.test.tsx \
  src/renderer/src/components/__tests__/WebLoginScreen.test.tsx
```

Expected: FAIL because the HTTP/session boundary is absent.

- [ ] **Step 3: Implement ordinary sessions and login UX**

Extract the reusable app-user PocketBase authentication attempt from `pocketbaseConnectionHandlers.ts` into an exported service function that returns only `PbConnectionResult`; retain retry/timeout behavior and keep IPC as a thin trusted adapter. For browser login, call it against the embedded PocketBase loopback URL using the submitted passphrase, then immediately discard the passphrase.

`WebSessionStore` keeps a separate PocketBase client/auth store per opaque session, timestamps, CSRF state, SSE sinks, and a disposal registry for later privileged/upload children. `refresh` uses the server-held PocketBase auth refresh path; if PocketBase rejects it, invalidate the browser session and require passphrase login again.

Implement ordered middleware in `WebRouter`: network/Host, headers and bounds, route lookup, Origin, session, CSRF, rate limit, schema parse, route handler, response projection, redacted logging. Restrict API routes to exact methods and make the server's static path incapable of reaching API fallbacks.

Finish `WebSessionGate` and the Relay-styled login screen. It shows server identity, passphrase, sign-in, generic failure, and the permanent HTTP warning. Keep the passphrase in component state only and clear it on every settled attempt. Bootstrap after reload uses the opaque cookie, not browser storage. Logout clears PocketBase auth in the renderer before returning to login.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run typecheck
npm run lint
```

Expected: all commands PASS. Inspection of cookies/storage shows no persistent auth material, and captured logs contain no submitted secrets.

- [ ] **Step 5: Commit ordinary browser sessions**

```bash
git add src/shared/webApi.ts src/shared/webApi.test.ts \
  src/main/web src/main/handlers/pocketbaseConnectionHandlers.ts \
  src/main/handlers/pocketbaseConnectionHandlers.test.ts \
  src/renderer/src/runtime src/renderer/src/components/WebLoginScreen.tsx \
  src/renderer/src/components/__tests__/WebLoginScreen.test.tsx \
  src/renderer/src/styles/setup.css
git commit -m "feat(web): secure browser sessions"
```

---

## Slice 4: Typed Web Bridge and Online Operational Parity

**Files:**

- Modify: `src/shared/webApi.ts`
- Modify: `src/shared/webApi.test.ts`
- Create: `src/main/services/CloudStatusService.ts`
- Modify: `src/main/handlers/cloudStatus/index.ts`
- Test: `src/main/handlers/cloudStatusHandlers.test.ts`
- Create: `src/main/services/DynatraceDashboardService.ts`
- Modify: `src/main/handlers/dynatraceHandlers.ts`
- Modify: `src/main/handlers/dynatraceProblemsHandlers.ts`
- Create: `src/main/services/BrandAssetService.ts`
- Modify: `src/main/handlers/windowHandlers.ts`
- Create: `src/main/web/routes/operationalRoutes.ts`
- Create: `src/main/web/routes/operationalRoutes.test.ts`
- Create: `src/renderer/src/runtime/WebBridge.ts`
- Create: `src/renderer/src/runtime/WebBridge.test.ts`
- Create: `src/renderer/src/runtime/browserActions.ts`
- Create: `src/renderer/src/runtime/browserActions.test.ts`
- Modify: `src/renderer/src/services/mutationGateway.ts`
- Test: `src/renderer/src/services/mutationGateway.test.ts`
- Modify: `src/renderer/src/stores/collectionStore.ts`
- Test: `src/renderer/src/stores/__tests__/collectionStore.test.ts`
- Modify: `src/renderer/src/services/pocketbase.ts`
- Test: `src/renderer/src/services/__tests__/pocketbase.test.ts`
- Modify: `src/renderer/src/hooks/useDataManager.ts`
- Test: `src/renderer/src/hooks/useDataManager.test.ts`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Test: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
- Modify: `src/renderer/src/tabs/assembler/ScheduleBridgeModal.tsx`
- Test: `src/renderer/src/tabs/assembler/__tests__/ScheduleBridgeModal.test.tsx`

**Interfaces:**

- Produces: exact typed operational routes for cloud status, Dynatrace dashboard metadata/configuration, Dynatrace Problems settings/test/sync/filter, brand assets, safe logging, and SSE invalidations.
- Produces: a complete `WebBridge` implementing `BridgeAPI`; unavailable desktop-only methods return typed safe failures or no-ops based on capability, never throw during render.
- Produces: browser-native validated external navigation, file selection, artifact download, built-in audio, popouts, text-copy fallback, and PNG download.
- Preserves: ordinary collection CRUD/realtime goes directly through the authenticated PocketBase SDK and existing collection rules.

- [ ] **Step 1: Write failing service, route, bridge, and online-only tests**

Require IPC and HTTP adapters to call the same injected domain service and return the same normalized public result. Assert each HTTP route has its own schema, required ordinary/privileged capability, body limit, and rate bucket; assert unknown operation names cannot be invoked.

Create a `BridgeAPI` conformance test that type-checks every method and behavior-tests all methods used by the renderer. Cover:

- external URLs allow only normalized HTTP(S) and use `noopener,noreferrer`;
- text copy first attempts the synchronous selection path, then renders/focuses exact text with Ctrl/Cmd+C instructions;
- PNG and generated EML/ICS/CSV/PDF artifacts download with sanitized bounded filenames;
- built-in audio waits for user activation and never requests a filesystem path;
- popouts use browser windows/tabs and Dynatrace dashboard launch uses an ordinary new tab, preserving browser SSO;
- custom reminder-sound selection, image clipboard, window controls, connection save/clear/discovery, backup/restore, and reset expose safe unavailable behavior;
- bridge event subscriptions unsubscribe from SSE cleanly.

Add web-runtime mutation/store regressions: offline/reconnecting writes reject without calling `mutateOffline`; cache read/write, pending sync, and replay are never called; stale records remain visible; recovery refetches before the mutation gate returns online.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/shared/webApi.test.ts \
  src/main/handlers/cloudStatusHandlers.test.ts \
  src/main/web/routes/operationalRoutes.test.ts \
  src/renderer/src/runtime/WebBridge.test.ts \
  src/renderer/src/runtime/browserActions.test.ts \
  src/renderer/src/services/mutationGateway.test.ts \
  src/renderer/src/stores/__tests__/collectionStore.test.ts \
  src/renderer/src/services/__tests__/pocketbase.test.ts \
  src/renderer/src/hooks/useDataManager.test.ts \
  src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/assembler/__tests__/ScheduleBridgeModal.test.tsx
```

Expected: FAIL because the shared services, web adapter, and web online-only path do not exist.

- [ ] **Step 3: Implement the operational bridge**

Move business logic currently embedded in cloud, Dynatrace, and asset IPC handlers into narrow injected services; leave trusted IPC registration and method names unchanged. Register explicit HTTP adapters around those services with route-level ordinary/privileged authorization.

Implement `WebBridge` as an exhaustive typed object. Its `getPbConnection`/`refreshPbConnection` use session bootstrap endpoints and load only the app-user token into the in-memory PocketBase auth store. It never returns superuser or privileged role tokens. Route SSE events to the existing callback-shaped bridge subscriptions.

Adapt renderer-only behaviors using browser APIs and capability checks. Alerts save PNG/EML instead of assuming Outlook or an image clipboard. ICS downloads instead of launching a native calendar handler. Copy keeps the selected text visible when blocked. The existing `useDataManager` browser-native import/export remains available, but backup/restore controls do not.

Make offline policy explicit in `mutationGateway` and `collectionStore`: Electron behavior is unchanged; web retains last state, disables writes, skips local cache/pending APIs, and performs authoritative refetch/resubscribe before returning to online.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run test:renderer
npm run typecheck
```

Expected: all commands PASS. An exhaustive bridge fixture demonstrates no renderer-used method is undefined in a browser session.

- [ ] **Step 5: Commit operational parity**

```bash
git add src/shared/webApi.ts src/shared/webApi.test.ts src/main/services \
  src/main/handlers/cloudStatus/index.ts src/main/handlers/cloudStatusHandlers.test.ts \
  src/main/handlers/dynatraceHandlers.ts \
  src/main/handlers/dynatraceProblemsHandlers.ts src/main/handlers/windowHandlers.ts \
  src/main/web/routes/operationalRoutes.ts \
  src/main/web/routes/operationalRoutes.test.ts src/renderer/src/runtime \
  src/renderer/src/services src/renderer/src/stores \
  src/renderer/src/hooks/useDataManager.ts src/renderer/src/hooks/useDataManager.test.ts \
  src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx \
  src/renderer/src/tabs/assembler/ScheduleBridgeModal.tsx \
  src/renderer/src/tabs/assembler/__tests__/ScheduleBridgeModal.test.tsx
git commit -m "feat(web): add online operational bridge"
```

---

## Slice 5: Isolated Privileged Web Sessions and Local Approval Codes

**Files:**

- Modify: `src/main/privileged/privilegedRuntime.ts`
- Test: `src/main/privileged/__tests__/privilegedRuntime.test.ts`
- Create: `src/main/privileged/ProductionPrivilegedHost.ts`
- Create: `src/main/privileged/__tests__/ProductionPrivilegedHost.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/app/runtimeReconfigure.ts`
- Create: `src/main/web/WebPrivilegedSession.ts`
- Create: `src/main/web/WebPrivilegedSession.test.ts`
- Create: `src/main/web/WebApprovalCodeStore.ts`
- Create: `src/main/web/WebApprovalCodeStore.test.ts`
- Create: `src/main/web/routes/privilegedRoutes.ts`
- Create: `src/main/web/routes/privilegedRoutes.test.ts`
- Modify: `src/shared/webApi.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Test: `src/shared/ipcValidation.test.ts`
- Modify: `src/main/handlers/privilegedAccessHandlers.ts`
- Test: `src/main/handlers/privilegedAccessHandlers.test.ts`
- Modify: `src/renderer/src/contexts/PrivilegedAccessContext.tsx`
- Test: `src/renderer/src/contexts/PrivilegedAccessContext.test.tsx`
- Create: `src/renderer/src/components/settings/WebApprovalRequestsPanel.tsx`
- Create: `src/renderer/src/components/settings/WebApprovalRequestsPanel.test.tsx`
- Modify: `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx`
- Test: `src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx`

**Interfaces:**

- Produces: one `ProductionPrivilegedHost` per server process, owning the shared repository, pairing service, command processor, registered administration/Knowledge commands, server queue, and search indexer.
- Produces: `createElectronRuntime()` and `createWebRuntime({ sessionId, source })`, each with an independent `PrivilegedPocketBaseClient` and `PrivilegedSessionManager` but shared server-local command processing.
- Produces: exact routes for privileged view/login/logout/reauthentication, command submission, credential setup/change, and paired-device administration.
- Produces: one-use desktop approval requests/codes bound to web session plus operation, expiring after ten minutes and locking after five failed attempts.
- Preserves: the browser is never stored as a paired device and receives no device private key or privileged token.

- [ ] **Step 1: Write failing host-isolation, command, and approval tests**

Create two web runtimes plus the Electron runtime. Require independent login/logout/idle-lock state and auth stores, but identical capability derivation and shared command revision behavior. Logging out browser A must not affect B or Electron. Authority changes must fan out to every active runtime. Disposing one child must not stop the server queue/indexer; disposing the host must close every child exactly once.

For web routes, exercise the existing typed allowlist, safe-result projection, optimistic revision, idempotency, fresh reauthentication proof, and capability errors. Assert audit context records `source: 'web'`, bounded browser family, and sanitized address label, never raw user-agent, password, token, or cookie.

For approval codes, require:

```ts
expect(request.operation).toBe('initial-owner-credential');
expect(store.consume({ requestId, sessionId: otherSession, code })).toBe(false);
```

Cover exact operation binding, ten-minute expiry, one use, cancellation, five bad attempts, server restart clearing, session disposal clearing, and code redaction. Require the desktop panel to display/generate/cancel pending requests only in the server Electron runtime. Require web initial Owner setup and recovery to fail generically until the matching code is consumed.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/main/privileged/__tests__/privilegedRuntime.test.ts \
  src/main/privileged/__tests__/ProductionPrivilegedHost.test.ts \
  src/main/web/WebPrivilegedSession.test.ts \
  src/main/web/WebApprovalCodeStore.test.ts \
  src/main/web/routes/privilegedRoutes.test.ts \
  src/shared/ipcValidation.test.ts \
  src/main/handlers/privilegedAccessHandlers.test.ts \
  src/renderer/src/contexts/PrivilegedAccessContext.test.tsx \
  src/renderer/src/components/settings/WebApprovalRequestsPanel.test.tsx \
  src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx
```

Expected: FAIL because the production factory currently owns one combined runtime and no approval boundary exists.

- [ ] **Step 3: Refactor the privileged host and add web sessions**

Separate shared server resources from session resources in `createProductionPrivilegedRuntime`. The new host registers administration and Knowledge commands once, starts one queue/indexer, and tracks child runtimes. Each child gets its own auth client/session manager and submits commands through `processLocal` with server-local trust; web children use a null paired `deviceId` and a bounded web source label.

Keep client-mode privileged runtime construction unchanged. In server mode, expose the host's Electron child through existing IPC so no renderer contract changes. Register web children in the owning ordinary `WebSessionStore` disposal registry. The web bridge maps the existing `PrivilegedAccessContext` methods onto exact routes and SSE session-change events.

Add desktop-only IPC for approval request listing/generation/cancellation and render it beside existing privileged settings. The gateway creates a pending request before sensitive first-owner/recovery operations; after successful code consumption, call the existing account manager/command path. Never let the shared connection passphrase bypass approval.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run test:unit
npm run test:renderer
npm run typecheck
```

Expected: all commands PASS. Existing Electron privileged tests remain unchanged in behavior, and simultaneous web sessions cannot observe or mutate one another's privileged state.

- [ ] **Step 5: Commit privileged web access**

```bash
git add src/main/privileged src/main/web src/main/index.ts \
  src/main/app/runtimeReconfigure.ts src/shared/webApi.ts src/shared/ipc.ts \
  src/shared/ipcValidation.ts src/shared/ipcValidation.test.ts \
  src/main/handlers/privilegedAccessHandlers.ts \
  src/main/handlers/privilegedAccessHandlers.test.ts \
  src/renderer/src/contexts/PrivilegedAccessContext.tsx \
  src/renderer/src/contexts/PrivilegedAccessContext.test.tsx \
  src/renderer/src/components/settings
git commit -m "feat(web): isolate privileged browser access"
```

---

## Slice 6: Browser Knowledge Read, Search, Upload, and Management

**Files:**

- Modify: `src/main/knowledge/KnowledgeUploadService.ts`
- Test: `src/main/knowledge/__tests__/KnowledgeUploadService.test.ts`
- Create: `src/main/web/WebKnowledgeUploadStaging.ts`
- Create: `src/main/web/WebKnowledgeUploadStaging.test.ts`
- Create: `src/main/web/WebKnowledgeSession.ts`
- Create: `src/main/web/WebKnowledgeSession.test.ts`
- Create: `src/main/web/routes/knowledgeRoutes.ts`
- Create: `src/main/web/routes/knowledgeRoutes.test.ts`
- Modify: `src/shared/webApi.ts`
- Modify: `src/renderer/src/runtime/WebBridge.ts`
- Modify: `src/renderer/src/runtime/WebBridge.test.ts`
- Modify: `src/renderer/src/features/knowledge/useKnowledgeManagement.ts`
- Test: `src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx`
- Modify: `src/renderer/src/features/knowledge/useKnowledgePassageSearch.ts`
- Test: `src/renderer/src/features/knowledge/__tests__/useKnowledgePassageSearch.test.tsx`
- Modify: `src/renderer/src/features/knowledge/useKnowledgeCover.ts`
- Test: `src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgePdfViewer.tsx`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeManagementWorkspace.tsx`
- Test: `src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx`

**Interfaces:**

- Produces: bounded routes for PDF bytes/ranges, covers, index status, passage search/cancel, management queue controls, upload-batch creation, raw file chunks, commit, and abort.
- Produces: `KnowledgeUploadService.queuePaths(paths, localSourceId)` so Electron selection and server-staged browser files share validation, hashing, chunk publication, scheduling, and command reconciliation.
- Produces: one `WebKnowledgeSession` per ordinary browser session with a non-paired internal source ID and its own queue/staging directory beneath Relay's managed temporary root.
- Preserves: existing privileged Knowledge commands, storage-capacity rules, filename/checksum validation, extraction, indexing, publishing, audit, and management UI.

- [ ] **Step 1: Write failing extraction, upload, cleanup, and renderer tests**

Refactor tests first so current Electron `selectAndQueue()` is expressed as file selection followed by a shared `queuePaths()` path. Require duplicate names, invalid PDF signatures, max files, per-file size, batch bytes, capacity, retry, pause/resume, and reconciliation behavior to remain identical.

For browser staging, cover:

- an authenticated `knowledge.manage` session starts a bounded batch and receives server-generated file IDs;
- chunk order, offset, length, per-file total, total batch size, concurrency, and content type are validated;
- chunks stream to Relay-owned temporary files without buffering a whole PDF in memory;
- the server computes checksum and validates PDF content before handing paths to `KnowledgeUploadService`;
- partial files are removed on abort, failed validation, logout, expiry, shutdown, and startup cleanup;
- after the final byte commit, upload processing continues when the tab disconnects while the server session remains valid;
- browser reload reattaches to the same queue through the opaque session;
- server restart invalidates the session and cleans its temporary sources, requiring a fresh selection rather than claiming recovery.

Require PDF/cover/search responses to match IPC normalization and authorization. In renderer tests, use `File` objects and assert selection, progress, queue controls, publishing, management snapshots, and search all reuse the current UI. Assert a blocked external Knowledge link opens only after URL normalization.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/main/knowledge/__tests__/KnowledgeUploadService.test.ts \
  src/main/web/WebKnowledgeUploadStaging.test.ts \
  src/main/web/WebKnowledgeSession.test.ts \
  src/main/web/routes/knowledgeRoutes.test.ts \
  src/renderer/src/runtime/WebBridge.test.ts \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeManagement.test.tsx \
  src/renderer/src/features/knowledge/__tests__/useKnowledgePassageSearch.test.tsx \
  src/renderer/src/features/knowledge/__tests__/useKnowledgeCover.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgePdfViewer.test.tsx \
  src/renderer/src/features/knowledge/__tests__/KnowledgeManagementWorkspace.test.tsx
```

Expected: FAIL because browser staging and shared queue ingestion do not exist.

- [ ] **Step 3: Implement the shared upload path and Knowledge routes**

Extract only filesystem selection from `KnowledgeUploadService.selectAndQueue`; keep one validation/scheduling path for both Electron-selected and gateway-staged paths. Add an internal `localSourceId` so concurrent browser sessions do not collide while still presenting `deviceId: null` to privileged/audit logic.

Stage browser bytes with Node streams and exclusive temporary files. The browser sends raw chunks because Web Crypto is unavailable on the accepted HTTP origin; the server performs hashing and PDF validation. On commit, transfer ownership of validated paths to the session's `KnowledgeUploadService`. Keep its web privileged child/session alive through server-side processing even if the SSE connection closes; ordinary session expiry/logout remains the disposal boundary.

Expose PDF, cover, index, search, upload, and queue controls through separately validated routes. Use streaming/range responses for PDF bytes and bounded JSON elsewhere. Update `WebBridge` file selection to a hidden multi-file PDF input and map current upload callbacks to HTTP plus SSE. Leave the current Knowledge workspace, role/capability checks, mutation confirmation, and published-library refresh intact.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run test:knowledge-upload-soak
npm run test:renderer
npm run typecheck
```

Expected: all commands PASS. Electron and browser uploads reach the same queue/publish implementation, and temporary files are absent after every tested terminal path.

- [ ] **Step 5: Commit Knowledge browser parity**

```bash
git add src/main/knowledge/KnowledgeUploadService.ts \
  src/main/knowledge/__tests__/KnowledgeUploadService.test.ts \
  src/main/web src/shared/webApi.ts src/renderer/src/runtime/WebBridge.ts \
  src/renderer/src/runtime/WebBridge.test.ts \
  src/renderer/src/features/knowledge
git commit -m "feat(web): add browser Knowledge workflows"
```

---

## Slice 7: Browser Parity UX, Presence, Reauthentication, and Notifications

**Files:**

- Create: `src/renderer/src/components/WebRuntimeBanner.tsx`
- Create: `src/renderer/src/components/__tests__/WebRuntimeBanner.test.tsx`
- Create: `src/renderer/src/components/WebReauthenticationOverlay.tsx`
- Create: `src/renderer/src/components/__tests__/WebReauthenticationOverlay.test.tsx`
- Create: `src/renderer/src/components/UnsupportedViewport.tsx`
- Create: `src/renderer/src/components/__tests__/UnsupportedViewport.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/components/ConnectionManager.tsx`
- Test: `src/renderer/src/components/__tests__/ConnectionManager.test.tsx`
- Modify: `src/renderer/src/components/WindowControls.tsx`
- Test: `src/renderer/src/components/__tests__/WindowControls.test.tsx`
- Modify: `src/renderer/src/components/DataManagerModal.tsx`
- Test: `src/renderer/src/components/__tests__/DataManagerModal.test.tsx`
- Modify: `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/renderer/src/components/__tests__/SettingsModal.test.tsx`
- Modify: `src/renderer/src/hooks/useClientPresence.ts`
- Modify: `src/renderer/src/hooks/__tests__/useClientPresence.test.ts`
- Modify: `src/renderer/src/components/SidebarPresence.tsx`
- Modify: `src/renderer/src/components/__tests__/SidebarPresence.test.tsx`
- Modify: `src/renderer/src/components/DynatraceProblemNotificationManager.tsx`
- Modify: `src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx`
- Modify: `src/renderer/src/hooks/useAppCloudStatus.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts`
- Modify: `src/renderer/src/components/AlertReminderManager.tsx`
- Test: `src/renderer/src/components/__tests__/AlertReminderManager.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles/responsive.css`
- Modify: `src/renderer/src/styles/components.css`

**Interfaces:**

- Produces: a persistent `Web` runtime label and exact unencrypted-network warning inside the authenticated shell.
- Produces: browser presence label `Web · <browser family> · <sanitized network label>` with a session-scoped non-secret presence ID.
- Produces: session-expired reauthentication overlay that preserves unsaved React state until login succeeds or the user explicitly discards it.
- Produces: desktop-only capability guards for only the agreed initial setup/connection configuration and PocketBase recovery actions; all other supported workflows remain visible or receive browser-specific actions.
- Preserves: current Dynatrace-first toast queue and current-outage-only seven-day cloud selector.

- [ ] **Step 1: Write failing parity, accessibility, viewport, presence, and notification tests**

Render the full shell under both runtime descriptors. For web, require:

- no Electron window controls, connection setup/reconfigure, backup/restore, destructive reset, custom sound picker, or image clipboard action;
- ordinary import/export, administration, paired devices, credential management, Dynatrace settings, Knowledge publishing, and all operational tabs remain present;
- the `Web` label and exact HTTP warning remain visible;
- 1024 by 768 uses the normal shell, while 1023 CSS pixels shows a focusable larger-window-required state and no dense app controls;
- keyboard focus, labels, dialogs, errors, reduced motion, and contrast-facing class contracts remain intact.

Simulate PocketBase loss during an edited form. Require visible stale content, disabled save/delete controls, no queued mutation, and a reconnect status. Simulate ordinary session expiry and require the reauthentication overlay to retain form state; successful login closes it and performs authoritative refetch before re-enabling save.

Require browser presence cleanup on logout/session expiry and normalization of Chrome, Edge, and Safari user agents without persisting the full string.

Lock notification regressions explicitly:

```ts
expect(dynatraceToast.options.delivery).toBe('dynatrace-problem');
expect(cloudToast.options.delivery).toBe('cloud-outage');
```

Assert cloud degradation, resolved, stale, and older-than-seven-day records never toast; active current outages do; Dynatrace preempts cloud; notifications render only while the authenticated tab is open; no code requests Notification permission, registers push, or creates a service worker.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/WebRuntimeBanner.test.tsx \
  src/renderer/src/components/__tests__/WebReauthenticationOverlay.test.tsx \
  src/renderer/src/components/__tests__/UnsupportedViewport.test.tsx \
  src/renderer/src/__tests__/App.test.tsx \
  src/renderer/src/components/__tests__/ConnectionManager.test.tsx \
  src/renderer/src/components/__tests__/WindowControls.test.tsx \
  src/renderer/src/components/__tests__/DataManagerModal.test.tsx \
  src/renderer/src/components/__tests__/SettingsModal.test.tsx \
  src/renderer/src/hooks/__tests__/useClientPresence.test.ts \
  src/renderer/src/components/__tests__/SidebarPresence.test.tsx \
  src/renderer/src/components/__tests__/DynatraceProblemNotificationManager.test.tsx \
  src/renderer/src/hooks/__tests__/useAppCloudStatus.test.ts \
  src/renderer/src/components/__tests__/AlertReminderManager.test.tsx
```

Expected: FAIL because browser-specific capability/connection/presence UX is incomplete.

- [ ] **Step 3: Implement final parity UX and notification wiring**

Use `hasRelayCapability()` at the few true capability boundaries, not browser-name checks scattered through features. Keep the existing Relay shell, typography, spacing, and operational density. Add only the compact runtime/warning treatment, reconnect/reauth states, and unsupported viewport surface.

In web `ConnectionManager`, keep components mounted while the ordinary session is refreshed. Freeze mutation capability, retain form state, and invalidate/refetch collection stores after reauthentication before unfreezing. If the user discards the expired session, clear PocketBase auth and return to `WebSessionGate`.

Publish browser presence through the existing `client_presence` collection with `mode: 'client'`, a bounded `Web` label, normalized browser family, and sanitized network label supplied by the gateway. Do not pair the browser or expose its session ID.

Reuse the existing toast managers exactly while the app is mounted. Keep `DynatraceProblemNotificationManager` on the priority delivery lane and `useAppCloudStatus` on its current outage/freshness selector. Browser reminder sounds use only bundled audio after user activation. Do not touch OS notification APIs.

- [ ] **Step 4: Verify GREEN**

Run the RED command plus:

```bash
npm run test:renderer
npm run typecheck
npm run lint
npm run format:check
```

Expected: all commands PASS with no accessibility warnings. Electron snapshots retain desktop controls and offline behavior; web snapshots show only the agreed adaptations.

- [ ] **Step 5: Commit web parity UX**

```bash
git add src/renderer/src/components src/renderer/src/hooks \
  src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx \
  src/renderer/src/styles.css src/renderer/src/styles
git commit -m "feat(web): complete browser parity experience"
```

---

## Slice 8: Cross-Browser E2E, Packaging, Compatibility, and Release Gates

**Files:**

- Create: `playwright.web.config.ts`
- Create: `scripts/run-web-tests.mjs`
- Create: `tests/web/fixtures/relayWebFixture.ts`
- Create: `tests/web/authentication.spec.ts`
- Create: `tests/web/operational-parity.spec.ts`
- Create: `tests/web/privileged-isolation.spec.ts`
- Create: `tests/web/knowledge-upload.spec.ts`
- Create: `tests/web/reconnect-notifications.spec.ts`
- Create: `tests/web/security-boundary.spec.ts`
- Create: `tests/web/responsive-accessibility.spec.ts`
- Modify: `package.json`
- Modify: `electron-builder.yml`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `tests/e2e/setup-auth.spec.ts`
- Create: `docs/relay-web.md`
- Modify: `README.md`

**Interfaces:**

- Produces: `npm run test:web` using Playwright Chromium and WebKit against a real server-mode Relay process and embedded PocketBase.
- Produces: optional installed Edge-channel smoke execution without making an unavailable local Edge binary fail unrelated CI.
- Produces: release/operator documentation for enablement, trusted network/VPN restriction, HTTP warning, browser URL/port conflict, session behavior, desktop-only actions, and troubleshooting.
- Preserves: Electron critical-path and setup/auth suites as compatibility gates.

- [ ] **Step 1: Write failing browser and cross-client acceptance tests**

Build a fixture that creates an isolated Relay user-data directory, fixed test ports, server config with web enabled, seeded PocketBase data, and clean teardown. It must start the packaged-equivalent main/renderer output, wait for both PocketBase and Relay Web health, and capture redacted process logs.

Cover these browser acceptance paths in Chromium and WebKit:

1. Login failure/success, cookie flags, reload bootstrap, logout, idle/absolute expiry, CSRF rejection, Host/Origin rejection, body limits, rate limits, and no secret leakage.
2. 1024x768, 1366x768, and 1440x900 navigation with keyboard-only focus; 1023-wide unsupported state.
3. Ordinary CRUD/realtime synchronization browser-to-Electron and Electron-to-browser, browser presence, stale disconnect state, disabled mutations, refetch/resubscribe recovery, and no offline replay.
4. Alert PNG/EML, schedule ICS, CSV/Excel export/import, copy fallback, validated external links, Dynatrace ordinary-tab launch, and no desktop-only recovery controls.
5. Two browser privileged sessions plus Electron: isolated login/logout/lock, administration, paired-device management, protected reauthentication, credential change, and desktop approval code.
6. Knowledge browse/search/PDF, multi-file upload/progress/publish/manage, reload resume, partial-upload cleanup, and server processing after tab close.
7. In-app outage notification newer than seven days, no stale/degradation toast, Dynatrace priority/preemption, and no notification after tab close.
8. Gateway disabled, web port conflict, gateway stop/retry, server shutdown, browser session cleanup, and existing Electron client continuity.

Add static artifact assertions that the packaged app contains the renderer assets once, starts no gateway when disabled, and does not include a service-worker or push-notification registration. Add a real Edge-channel smoke target for release machines where `msedge` is installed; document real Safari manual smoke on the supported macOS release because Playwright WebKit is an engine proxy, not the Safari application.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
npm run test:web
npm run test:electron
```

Expected: the new browser suite initially FAILS until all fixture integration and final packaging gaps are complete; existing Electron tests must continue to PASS.

- [ ] **Step 3: Finish fixture, packaging, and operator guidance**

Add `test:web` and an optional `test:web:edge` script. Ensure the fixture never uses the user's live data/config and always stops gateway, PocketBase, Electron, browser contexts, and temporary files.

Update packaging only as needed to serve the already built renderer assets. Document exact enable/retry steps, default port `8091`, URL formation, LAN/VPN-only scope, unencrypted HTTP risk, current Chrome/Edge/Safari support, minimum viewport, session limits, desktop-only exclusions, and expected unavailable behavior when the server app stops. Include a release checklist for real Chrome, Edge, and Safari smoke testing on target hardware.

Fix only issues proven by the acceptance suite. Do not weaken security assertions, skip engines, or add separate browser-only product logic to make tests pass.

- [ ] **Step 4: Run focused browser verification**

Run:

```bash
npm run build
npm run test:web
npm run test:electron
```

Expected: Chromium, WebKit, and Electron suites PASS. Run `npm run test:web:edge` on a release workstation with Edge installed and complete the documented real Safari smoke on macOS.

- [ ] **Step 5: Run the complete final gates**

From a clean process state, run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:cache
npm run test:renderer
npm run test:knowledge-upload-soak
npm run build
npm run test:electron
npm run test:web
git diff --check
git status --short
```

Expected: every command PASS; `git diff --check` has no output; status contains only the intentional implementation/docs changes before the final commit.

- [ ] **Step 6: Perform one independent final review**

Give one independent reviewer the approved design, this implementation plan, the final diff, and fresh test evidence. Ask specifically for:

- Electron client/server regressions;
- generic or over-broad web routes;
- session, CSRF, Host/Origin, network-scope, rate-limit, and redaction gaps;
- cross-session privileged leakage or browser pairing;
- temporary-file/upload cleanup failures;
- stale/offline browser writes;
- accidentally hidden in-scope parity features; and
- notification-policy regressions.

Address every validated finding with a focused regression test, rerun the affected focused suite, then rerun the complete final gates above. Do not request a second review unless the first review finds a structural issue whose fix materially changes the reviewed architecture.

- [ ] **Step 7: Commit the verified browser release**

```bash
git add playwright.web.config.ts scripts/run-web-tests.mjs tests/web \
  tests/e2e package.json electron-builder.yml docs/relay-web.md README.md
git commit -m "test(web): verify Relay browser backup"
```

## Acceptance Checklist

- [ ] Enabling Relay Web on a server desktop exposes exactly the configured LAN/VPN URL while that app is running; disabling it or stopping the app closes the endpoint.
- [ ] Existing Electron server and client startup, auth, pairing, offline cache, queued writes, privileged access, and Knowledge workflows remain passing and behaviorally unchanged.
- [ ] Chrome, Edge, and Safari desktop users at 1024 CSS pixels or wider can sign in with the connection passphrase and use every in-scope workflow.
- [ ] The browser never offers initial Relay server setup/connection configuration, PocketBase backup/restore, or destructive reset.
- [ ] Ordinary browser writes are direct and online-only; disconnect preserves stale state but disables mutation, and recovery refetches before re-enabling it.
- [ ] Ordinary, privileged, and approval-code session material is isolated, nonpersistent, bounded, redacted, and cleaned on every terminal path.
- [ ] Browser privileged access can administer role accounts, credentials, paired Electron devices, Dynatrace settings, and Knowledge without pairing the browser.
- [ ] Browser Knowledge uploads stream through bounded server staging into the existing publication pipeline and clean all temporary data.
- [ ] In-app notifications work while the tab is open; Dynatrace always takes priority; provider notifications are current outage-only within seven days; no OS push/closed-tab claim exists.
- [ ] The UI always discloses `Trusted LAN/VPN only - browser traffic is not encrypted` and documentation clearly records the accepted HTTP interception risk.
