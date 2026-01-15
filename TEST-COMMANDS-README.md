# BTCP Server Test Script

Comprehensive test script for commanding the BTCP server to send browser automation commands.

## Prerequisites

1. **BTCP Server Running**
   ```bash
   npm run start:server
   ```
   Server should be running on `http://localhost:8765`

2. **Chrome Extension Loaded**
   - Load the Chrome extension in development mode
   - Extension should connect to the BTCP server
   - Check the popup UI to ensure "BTCP Server" shows as connected

## Running the Test Script

```bash
cd /Users/minh/Documents/btcp/btcp-server
npm run test:commands
```

## What the Script Does

The test script demonstrates how to:

1. **Connect to BTCP Server** via SSE (Server-Sent Events)
2. **Send browser automation commands** using JSON-RPC 2.0 protocol
3. **Receive real-time responses** from the browser

## Test Scenarios

### Scenario 1: Simple Navigation
- Navigate to example.com
- Take a screenshot
- Read the page's accessibility tree

### Scenario 2: Form Interaction
- Navigate to a form page (httpbin.org)
- Fill multiple input fields
- Take a full-page screenshot

### Scenario 3: JavaScript Execution
- Navigate to a page
- Execute JavaScript to read document.title
- Change page background color via JavaScript
- Capture screenshot of the result

### Scenario 4: Tab Management
- List all open windows and tabs
- Navigate to a new URL
- List tabs again to see changes

## Available Helper Functions

The script provides these helper functions you can use:

```typescript
// Navigation
await navigateToUrl('https://example.com');

// Element interaction
await clickElement('button.submit');
await fillInput('input[name="email"]', 'user@example.com');

// Page information
await readPage('interactive');  // or 'all'
await getWindowsAndTabs();

// Screenshots
await takeScreenshot(false);  // Current viewport
await takeScreenshot(true);   // Full page

// JavaScript execution
await executeJavaScript('document.querySelector("h1").textContent');

// Tool discovery
await listTools();
```

## Customizing the Test Script

You can modify `test-commands.ts` to add your own test scenarios:

```typescript
async function myCustomTest() {
  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`MY CUSTOM TEST`, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);

  await navigateToUrl('https://mywebsite.com');
  await wait(2000);

  await clickElement('#login-button');
  await wait(1000);

  await fillInput('#username', 'testuser');
  await fillInput('#password', 'testpass');
  await wait(500);

  await clickElement('button[type="submit"]');
  await wait(2000);

  await takeScreenshot(true);
}

// Add to runTests() function:
await myCustomTest();
await wait(2000);
```

## Understanding the Output

The script uses colored console output:

- 🔵 **Cyan** - Commands being sent
- 🟢 **Green** - Successful responses
- 🟡 **Yellow** - Warnings
- 🔴 **Red** - Errors
- **Bright** - Important information

Example output:
```
🌐 Navigate to: https://example.com
✅ Response received (id: test-1234567890-1)
   Navigated to https://example.com

📸 Take screenshot (fullPage: false)
✅ Response received (id: test-1234567890-2)
   [Image data: data:image/png;base64,iVBORw0KGg...]
```

## JSON-RPC Message Format

All commands use JSON-RPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "method": "tools/call",
  "params": {
    "name": "chrome_navigate",
    "arguments": {
      "url": "https://example.com"
    }
  }
}
```

Responses:
```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Navigated to https://example.com"
      }
    ],
    "isError": false
  }
}
```

## Available Browser Tools

The Chrome extension registers these tools with the BTCP server:

### Navigation & Tabs
- `chrome_navigate` - Navigate to URL or back/forward
- `chrome_switch_tab` - Switch to specific tab
- `chrome_close_tabs` - Close tabs
- `get_windows_and_tabs` - List all windows/tabs

### Page Reading
- `chrome_read_page` - Get accessibility tree
- `chrome_get_web_content` - Extract page content
- `chrome_screenshot` - Capture screenshots

### Interaction
- `chrome_click_element` - Click elements
- `chrome_fill_or_select` - Fill inputs/select options
- `chrome_keyboard` - Send keyboard input
- `chrome_computer` - Claude Computer Use compatible

### Advanced
- `chrome_javascript` - Execute JavaScript
- `chrome_console` - Capture console logs
- `chrome_network_capture` - Monitor network requests
- `chrome_history` - Search browser history
- `chrome_bookmark_*` - Bookmark management
- `chrome_handle_dialog` - Handle alerts/confirms
- `chrome_handle_download` - Handle downloads
- `chrome_upload_file` - Upload files
- `performance_*` - Performance tracing

## Troubleshooting

### "SSE connection failed"
- Ensure BTCP server is running: `npm run start:server`
- Check server is on port 8765
- Verify no firewall blocking localhost connections

### "No response from browser"
- Ensure Chrome extension is loaded
- Check extension is connected to BTCP server (popup UI)
- Open browser console to check for extension errors

### "Tool call error"
- Some tools only work on specific pages
- Check tool parameter requirements
- Verify page is fully loaded before interaction

## Architecture

```
Test Script (Agent)
    ↓ HTTP POST /message
BTCP Server (localhost:8765)
    ↓ SSE /events (to browser)
Chrome Extension
    ↓ Chrome APIs
Browser Automation
```

## Next Steps

1. **Modify test scenarios** to match your testing needs
2. **Add new helper functions** for commonly used operations
3. **Create integration tests** using this as a foundation
4. **Build automation workflows** combining multiple commands

## License

MIT
