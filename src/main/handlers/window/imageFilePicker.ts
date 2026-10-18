import { dialog } from 'electron';
import { openRegularFile } from '../../utils/regularFile';

type PickedImageFile =
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
  // Size-check and read the same opened file; the user may pick a shortcut, so links are allowed.
  const opened = await openRegularFile(selectedFile, { rejectSymlinks: false });
  if (!opened) return { success: false, error: options.sizeError };
  const { handle, stats } = opened;
  try {
    if (stats.size > BigInt(options.maxBytes)) {
      return { success: false, error: options.sizeError };
    }
    return { success: true, buffer: await handle.readFile(), filePath: selectedFile };
  } finally {
    await handle.close();
  }
}
