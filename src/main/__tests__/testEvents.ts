/**
 * IPC event stub that passes the trusted-sender guard in tests.
 * Requires the test file to set ELECTRON_RENDERER_URL to 'http://localhost:5173'
 * and mock electron's `app.isPackaged` as false.
 */
export function trustedEvent() {
  const frame = { url: 'http://localhost:5173/' };
  return { senderFrame: frame, sender: { mainFrame: frame } };
}
