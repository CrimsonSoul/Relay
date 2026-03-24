import { type BrowserWindow, Menu } from 'electron';

/**
 * Attach a context-menu handler to the given window that provides
 * spellcheck suggestions and standard Cut/Copy/Paste actions.
 */
export function setupContextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    // Spellcheck suggestions when a word is misspelled
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.map((suggestion) => ({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion),
      }));
      if (suggestions.length === 0) {
        menuItems.push({ label: 'No suggestions', enabled: false });
      } else {
        menuItems.push(...suggestions);
      }
      menuItems.push(
        { type: 'separator' },
        {
          label: 'Add to Dictionary',
          click: () =>
            win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
        { type: 'separator' },
      );
    }

    // Standard editing actions for editable fields
    if (params.isEditable) {
      menuItems.push(
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      // Allow copying selected text in non-editable areas
      menuItems.push({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy });
    }

    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup();
    }
  });
}
