import { ipcMain, BrowserWindow, app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import { generateAuthNonce, registerAuthRequest, consumeAuthRequest, cancelAuthRequest, cacheCredentials, getCachedCredentials } from '../credentialManager';
import { loggers } from '../logger';

export function setupAuthHandlers() {
  ipcMain.handle(IPC_CHANNELS.AUTH_SUBMIT, async (_event, { nonce, username, password, remember }) => {
    const authRequest = consumeAuthRequest(nonce);
    if (!authRequest) { loggers.auth.warn('Invalid or expired auth nonce'); return false; }
    if (remember) cacheCredentials(authRequest.host, username, password);
    authRequest.callback([username, password]);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_USE_CACHED, async (_event, { nonce }) => {
    const authRequest = consumeAuthRequest(nonce);
    if (!authRequest) { loggers.auth.warn('Invalid or expired auth nonce for cached auth'); return false; }
    const cached = getCachedCredentials(authRequest.host);
    if (!cached) { loggers.auth.warn('No cached credentials for host', { host: authRequest.host }); return false; }
    authRequest.callback([cached.username, cached.password]);
    return true;
  });

  ipcMain.on(IPC_CHANNELS.AUTH_CANCEL, (_event, { nonce }) => cancelAuthRequest(nonce));
}

export function setupAuthInterception(getMainWindow: () => BrowserWindow | null) {
  app.on('login', (event: Electron.Event, _webContents: Electron.WebContents, _request: Electron.AuthenticationResponseDetails, authInfo: Electron.AuthInfo, callback: (username?: string, password?: string) => void) => {
    event.preventDefault();
    const nonce = generateAuthNonce();
    registerAuthRequest(nonce, authInfo.host, callback);
    const cachedCreds = getCachedCredentials(authInfo.host);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.AUTH_REQUESTED, { host: authInfo.host, isProxy: authInfo.isProxy, nonce, hasCachedCredentials: cachedCreds !== null });
    }
  });
}
