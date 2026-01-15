import time
import json
from playwright.sync_api import sync_playwright, Page, expect

MOCK_SERVERS = [
    {
        "id": "1",
        "name": "Server-Alpha-01",
        "os": "Windows",
        "businessArea": "Finance",
        "lob": "Trading",
        "owner": "John Doe",
        "contact": "Jane Smith",
        "comment": "Primary trading server",
        "status": "active",
        "ip": "10.0.0.1",
        "port": 8080,
        "tags": []
    },
    {
        "id": "2",
        "name": "Server-Beta-02",
        "os": "Linux",
        "businessArea": "HR",
        "lob": "Payroll",
        "owner": "Alice Jones",
        "contact": "Bob Brown",
        "comment": "Payroll backup",
        "status": "inactive",
        "ip": "10.0.0.2",
        "port": 22,
        "tags": []
    }
]

def verify_server_card_resize(page: Page):
    # Inject Mock API
    page.add_init_script("""
        const mockData = {
            groups: {},
            contacts: [
                { name: 'John Doe', email: 'john@example.com' },
                { name: 'Jane Smith', email: 'jane@example.com' }
            ],
            servers: %s,
            lastUpdated: Date.now()
        };

        window.api = {
            subscribeToData: (cb) => { cb(mockData); return () => {}; },
            subscribeToRadar: (cb) => {},
            onReloadStart: (cb) => { return () => {}; },
            onReloadComplete: (cb) => { return () => {}; },
            onDataError: (cb) => { return () => {}; },
            onImportProgress: (cb) => {},
            getMetrics: async () => ({}),
            openPath: async () => {},
            openExternal: async () => {},
            openGroupsFile: async () => {},
            openContactsFile: async () => {},
            importGroupsFile: async () => {},
            importContactsFile: async () => {},
            importServersFile: async () => {},
            reloadData: async () => {},
            onAuthRequested: () => {},
            submitAuth: () => {},
            cancelAuth: () => {},
            useCachedAuth: async () => false,
            logBridge: () => {},
            resetMetrics: async () => {},
            addContact: async () => {},
            removeContact: async () => {},
            addServer: async () => {},
            removeServer: async () => {},
            addGroup: async () => {},
            addContactToGroup: async () => {},
            removeContactFromGroup: async () => {},
            importContactsWithMapping: async () => {},
            changeDataFolder: async () => {},
            resetDataFolder: async () => {},
            getDataPath: async () => '/mock',
            removeGroup: async () => {},
            renameGroup: async () => {},
            updateOnCallTeam: async () => {},
            removeOnCallTeam: async () => {},
            renameOnCallTeam: async () => {},
            saveAllOnCall: async () => {},
            windowMinimize: () => {},
            windowMaximize: () => {},
            windowClose: () => {},
            isMaximized: async () => true,
            onMaximizeChange: (cb) => {},
            removeMaximizeListener: () => {},
            generateDummyData: async () => {},
            getIpLocation: async () => null,
            logToMain: () => {},
            getWeather: async () => null,
            searchLocation: async () => [],
            getWeatherAlerts: async () => [],
            platform: 'linux'
        };
    """ % json.dumps(MOCK_SERVERS))

    print("Navigating...")
    page.goto("http://localhost:4173")
    print("Page title:", page.title())

    # Take debug screenshot
    page.screenshot(path="verification/debug_initial.png")

    # Check if Sidebar exists
    print("Checking sidebar...")
    # Navigate to Servers tab using aria-label
    print("Clicking Servers...")
    page.get_by_label("Servers").click()

    # Wait for servers to appear
    print("Waiting for server...")
    expect(page.get_by_text("Server-Alpha-01")).to_be_visible()

    # Narrow View (< 900px)
    page.set_viewport_size({"width": 800, "height": 800})
    time.sleep(1) # Wait for resize and render
    page.screenshot(path="verification/servers_narrow.png")
    print("Narrow screenshot taken")

    # Wide View (> 900px)
    page.set_viewport_size({"width": 1000, "height": 800})
    time.sleep(1) # Wait for resize and render
    page.screenshot(path="verification/servers_wide.png")
    print("Wide screenshot taken")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_server_card_resize(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
