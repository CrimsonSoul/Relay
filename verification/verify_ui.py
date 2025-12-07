from playwright.sync_api import sync_playwright

def verify_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a device scale factor to ensure high-quality screenshot
        context = browser.new_context(viewport={'width': 1200, 'height': 800})
        page = context.new_page()

        # Navigate to the preview server
        try:
            page.goto("http://localhost:4173")

            # 1. Verify Sidebar Tabs Renaming
            # Check for new tab names
            page.wait_for_selector('text=Compose')
            page.wait_for_selector('text=People')
            page.wait_for_selector('text=Reports')
            page.wait_for_selector('text=Live')

            # 2. Verify World Clock Changes
            # Check for CST
            page.wait_for_selector('text=CST')

            # 3. Verify Breadcrumb
            # Check for "Relay / Compose"
            page.wait_for_selector('text=Relay / Compose')

            # 4. Verify Input Styling in Compose Tab
            # Check if input has correct class or style (indirectly via visual screenshot)
            # Focus on the input to see if focus state works (border change) - hard to capture in static shot but we can try
            page.get_by_placeholder("Enter email address...").click()

            # 5. Verify Settings Modal & Sync Button
            # Open settings
            page.get_by_title("Settings").click()
            page.wait_for_selector('text=Settings')
            page.wait_for_selector('text=Sync Now')

            # Take screenshot of the settings open state
            page.screenshot(path="verification/settings_sync.png")

            # Close settings to see the main UI again
            page.get_by_text("Close").click()

            # Take main UI screenshot
            page.screenshot(path="verification/main_ui.png")

            print("Verification screenshots captured.")

        except Exception as e:
            print(f"Error during verification: {e}")
            # Take error screenshot
            page.screenshot(path="verification/error_state.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_changes()
