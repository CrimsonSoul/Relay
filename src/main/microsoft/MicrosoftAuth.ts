import { PublicClientApplication, LogLevel, AccountInfo, CryptoProvider } from '@azure/msal-node';
import { msalConfig, GRAPH_SCOPES } from './AuthConfig';
import { shell, BrowserWindow } from 'electron';

export class MicrosoftAuth {
  private pca: PublicClientApplication;
  private account: AccountInfo | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.pca = new PublicClientApplication(msalConfig);
  }

  public async initialize() {
    // MSAL Node 2.x+ might need specific initialization if we use persistence,
    // but basic PublicClientApplication is synchronous in constructor, async init usually for cache plugin.
    // We will verify if specific init is needed. MSAL Node v2+ usually works out of box.
    // Actually, PCA in MSAL Node might not have an async init method like MSAL Browser.
    // Checking docs: new PublicClientApplication(config) is enough.
  }

  public async login(): Promise<string | null> {
    const openBrowser = async (url: string) => {
      await shell.openExternal(url);
    };

    try {
      // Using Device Code Flow as it's robust for Electron without deep linking setup
      // Or Interactive with loopback.
      // Let's try Interactive with a loopback server if possible, but Device Code is safer for "No Access" scenarios
      // because it doesn't require registering a specific redirect URI (localhost is usually allowed but sometimes tricky).
      // Wait, "common" authority requires multi-tenant.
      // Let's use `acquireTokenInteractive` with a loopback server.

      const response = await this.pca.acquireTokenInteractive({
        scopes: GRAPH_SCOPES,
        openBrowser,
        successTemplate: '<h1>Successfully signed in!</h1> <p>You can close this window and return to Relay.</p>',
        errorTemplate: '<h1>Something went wrong</h1> <p>Check the console for details.</p>'
      });

      if (response && response.account) {
        this.account = response.account;
        return response.accessToken;
      }
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
    return null;
  }

  public async getToken(): Promise<string | null> {
    if (!this.account) return null;

    try {
      const response = await this.pca.acquireTokenSilent({
        account: this.account,
        scopes: GRAPH_SCOPES
      });
      return response.accessToken;
    } catch (error) {
      // If silent fails, might need interaction, but we return null and let caller decide
      console.warn('Silent token acquisition failed:', error);
      return null;
    }
  }

  public getAccount() {
    return this.account;
  }
}
