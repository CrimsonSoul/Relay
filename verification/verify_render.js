import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Mock window.api since we are running in preview mode
  await page.addInitScript(() => {
    window.api = {
        subscribeToData: (cb) => {
            cb({
                groups: { 'Engineering': ['alice@example.com'], 'Design': ['bob@example.com'] },
                contacts: [
                    { name: 'Alice Smith', email: 'alice@example.com', title: 'Engineer', phone: '1234567890', _searchString: 'alice smith' },
                    { name: 'Bob Jones', email: 'bob@example.com', title: 'Designer', phone: '0987654321', _searchString: 'bob jones' },
                    { name: 'Charlie Day', email: 'charlie@example.com', title: 'Manager', phone: '5555555555', _searchString: 'charlie day' }
                ],
                servers: [],
                lastUpdated: Date.now()
            });
        },
        onReloadStart: () => {},
        onReloadComplete: () => {},
        removeContactFromGroup: async () => true,
        addContactToGroup: async () => true,
        addContact: async () => true,
        removeContact: async () => true,
        importGroupsFile: async () => {},
        importContactsFile: async () => {},
        importServersFile: async () => {},
        reloadData: async () => {}
    };
  });

  try {
      await page.goto('http://127.0.0.1:4173');

      // Wait for app to load
      await page.waitForTimeout(3000);

      // Take screenshot of initial state (Compose)
      await page.screenshot({ path: 'verification/initial.png' });

      // Click the second sidebar button (People)
      // The Sidebar puts buttons in a `nav`.
      await page.locator('nav button').nth(1).click();

      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'verification/people_tab.png' });

      // Check if rows are rendered
      const alice = page.getByText('Alice Smith');
      if (await alice.isVisible()) {
          console.log('Alice is visible');
      } else {
          console.log('Alice is NOT visible');
      }

  } catch (e) {
      console.error(e);
      await page.screenshot({ path: 'verification/error.png' });
  } finally {
      await browser.close();
  }
})();
