const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 640, height: 480 });
  await window.loadURL('about:blank');
});

app.on('window-all-closed', () => app.quit());
