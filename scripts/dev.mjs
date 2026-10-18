import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Terminals inside Electron apps (VS Code, Claude) export ELECTRON_RUN_AS_NODE=1, which makes
// Relay's Electron binary start as plain Node. cmd.exe has no `VAR= command` form, so the
// variable is cleared here, the same way on every platform.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'),
);
const electronVite = fileURLToPath(
  new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url),
);

const child = spawn(process.execPath, [electronVite, 'dev', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
