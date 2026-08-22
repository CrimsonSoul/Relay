import { dialog } from 'electron';
import { readFile, stat } from 'node:fs/promises';

export type PickedImageFile =
  { success: true; buffer: Buffer; filePath: string } | { success: false; error: string };

export async function pickImageFile(options: {
  title: string;
  maxBytes: number;
  sizeError: string;
}): Promise<PickedImageFile> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: options.title,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { success: false, error: 'Cancelled' };

  const selectedFile = filePaths[0];
  const fileStat = await stat(selectedFile);
  if (fileStat.size > options.maxBytes) {
    return { success: false, error: options.sizeError };
  }

  return { success: true, buffer: await readFile(selectedFile), filePath: selectedFile };
}
