const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.disableHardwareAcceleration();
const variant = process.argv[process.argv.length - 1];
const outputByVariant = {
  mac: path.join(__dirname, 'icon-mac-1024.png'),
  win: path.join(__dirname, 'icon-win-1024.png'),
};
const outputPath = outputByVariant[variant];
if (!outputPath) {
  console.error(`Invalid icon variant: ${variant}`);
  process.exit(1);
}
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
    });
    await win.loadFile(path.join(__dirname, 'icon.html'));
    if (variant === 'win')
      await win.webContents.executeJavaScript(`document.body.classList.add('win'); true`);
    await win.webContents.executeJavaScript(`document.fonts.ready.then(() => true)`);
    await new Promise((r) => setTimeout(r, 300));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    fs.writeFileSync(outputPath, image.toPNG());
    console.log('rendered', variant);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
