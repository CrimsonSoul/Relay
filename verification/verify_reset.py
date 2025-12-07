from playwright.sync_api import sync_playwright

def verify_reset_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Mock window.api
        page.add_init_script("""
            window.api = {
                getDataPath: async () => 'C:/Users/User/AppData/Roaming/Relay/data',
                resetDataFolder: async () => true,
                changeDataFolder: async () => true,
                onReloadStart: () => {},
                onReloadComplete: () => {},
                subscribeToData: () => {},
                onAuthRequested: () => {},
                subscribeToRadar: () => {},
                getMetrics: async () => ({ bridgesLast7d: 0, bridgesLast30d: 0, bridgesLast6m: 0, bridgesLast1y: 0, topGroups: [] }),
            };
        """)

        # Navigate to preview
        page.goto("http://127.0.0.1:4173")

        # Open Settings Menu
        settings_btn = page.get_by_role("button", name="Settings")
        settings_btn.click()

        # Wait a bit
        page.wait_for_timeout(1000)

        # Print all buttons
        buttons = page.locator("button").all_inner_texts()
        print("Buttons found:", buttons)

        # Verify Reset Button
        reset_button = page.get_by_text("Reset to Default")
        if reset_button.is_visible():
            print("Reset button is visible")
        else:
            print("Reset button is NOT visible")
            # Dump HTML
            print(page.content())

        # Screenshot
        page.screenshot(path="verification/settings_menu_debug.png")
        browser.close()

if __name__ == "__main__":
    verify_reset_button()
