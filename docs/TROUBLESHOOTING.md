# Troubleshooting

## ELECTRON_RUN_AS_NODE breaks Electron startup

### Symptoms

When running `npm run dev`, the app fails with one of:

- `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`
- `TypeError: Cannot read properties of undefined (reading 'exports')` in `cjsPreparseModuleExports`
- `Cannot find module 'electron'` when using `require('electron')`

The `electron` module appears empty or unavailable despite being installed correctly. ESM imports get an empty object, CJS require either fails or returns the Electron binary path as a string instead of the module.

### Cause

The environment variable `ELECTRON_RUN_AS_NODE=1` is set. This is an official Electron flag that forces the Electron binary to behave as a plain Node.js process, completely disabling the `electron` builtin module. When set, `process.type` is `undefined` (instead of `'browser'`) and all Electron APIs are inaccessible.

This variable can be injected by Electron-based development tools running as parent processes. Known examples:

- **Antigravity** (macOS, installed via Homebrew) — sets `ELECTRON_RUN_AS_NODE=1` in its shell environment, which is inherited by child processes including `npm run dev`.

### Fix

The `dev` script in `package.json` explicitly clears the variable before launching:

```json
"dev": "ELECTRON_RUN_AS_NODE= electron-vite dev"
```

The `ELECTRON_RUN_AS_NODE=` prefix (with no value) unsets the variable for that command.

### Diagnosis

If you suspect this issue, run the following inside the Electron binary to check:

```bash
# Check if the variable is set in your shell
echo $ELECTRON_RUN_AS_NODE

# Test directly with the Electron binary
./node_modules/.bin/electron -e "console.log('process.type:', process.type)"
```

- If `process.type` prints `browser`, Electron is running normally.
- If `process.type` prints `undefined`, `ELECTRON_RUN_AS_NODE` is active and Electron is running as plain Node.js.

## Window visible in dock but not on screen

### Symptoms

After `npm run dev`, the Electron icon appears in the macOS dock but no window is visible.

### Cause

The `BrowserWindow` is created with `show: false` and relies on the `ready-to-show` event to call `mainWindow.show()`. If the event listener is registered after `loadURL` is awaited, the event fires during the load and the listener misses it.

### Fix

The `ready-to-show` listener must be registered **before** calling `loadURL` or `loadFile` in `src/main/index.ts`:

```typescript
// Register BEFORE loadURL
mainWindow.once('ready-to-show', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

// Then load the page
if (isDev) {
  await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
} else {
  await mainWindow.loadFile(indexPath);
}
```
