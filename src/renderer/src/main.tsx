import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { initAccent } from './theme/accent';

initAccent();

const rootElement = document.getElementById('root') as HTMLElement;
const root = ReactDOM.createRoot(rootElement);

function renderApp(app: React.ReactNode): void {
  root.render(import.meta.env.DEV ? <React.StrictMode>{app}</React.StrictMode> : app);
}

async function bootstrapRenderer(): Promise<void> {
  if (globalThis.api) {
    const { default: App } = await import('./App');
    renderApp(<App />);
    return;
  }

  const { WebSessionGate } = await import('./runtime/WebSessionGate');
  renderApp(<WebSessionGate />);
}

void bootstrapRenderer().catch(() => {
  renderApp(
    <main className="app-state" role="alert">
      <p className="app-state__text">Relay could not start.</p>
    </main>,
  );
});
