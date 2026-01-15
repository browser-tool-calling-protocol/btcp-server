#!/usr/bin/env node
/**
 * BTCP Server Test Script
 *
 * Commands the BTCP server to send browser automation commands.
 * Usage: npm run test:commands
 */

import http from 'http';
import type { IncomingMessage } from 'http';

const SERVER_URL = 'http://localhost:8765';
const SESSION_ID = `test-session-${Date.now()}`;
let messageId = 0;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

// Generate unique message ID
function generateId(): string {
  return `test-${Date.now()}-${++messageId}`;
}

// Send JSON-RPC message to server
async function sendMessage(message: any): Promise<void> {
  const data = JSON.stringify(message);
  const url = new URL(`${SERVER_URL}/message?sessionId=${SESSION_ID}`);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res: IncomingMessage) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk.toString();
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Connect to SSE stream for receiving responses
function connectSSE(): Promise<void> {
  return new Promise((resolve, reject) => {
    const agentSessionId = `agent-${Date.now()}`;
    const url = `${SERVER_URL}/events?sessionId=${agentSessionId}&clientType=agent`;

    log(`\n📡 Connecting to SSE stream...`, colors.cyan);
    log(`   URL: ${url}`, colors.cyan);

    http.get(url, (res: IncomingMessage) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE connection failed: HTTP ${res.statusCode}`));
        return;
      }

      log(`✅ Connected to SSE stream`, colors.green);
      resolve();

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const message = JSON.parse(data);
                handleSSEMessage(message);
              } catch (err) {
                log(`⚠️  Failed to parse SSE message: ${data}`, colors.yellow);
              }
            }
          }
        }
      });

      res.on('end', () => {
        log(`\n❌ SSE connection closed`, colors.red);
      });

      res.on('error', (err) => {
        log(`\n❌ SSE error: ${err.message}`, colors.red);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Handle messages from SSE stream
function handleSSEMessage(message: any) {
  if (message.method === 'notifications/message') {
    log(`\n📬 Notification: ${JSON.stringify(message.params, null, 2)}`, colors.blue);
    return;
  }

  if (message.result) {
    log(`\n✅ Response received (id: ${message.id})`, colors.green);

    if (message.result.content) {
      for (const content of message.result.content) {
        if (content.type === 'text') {
          log(`   ${content.text}`, colors.bright);
        } else if (content.type === 'image') {
          log(`   [Image data: ${content.data?.substring(0, 50)}...]`, colors.bright);
        }
      }
    }

    if (message.result.isError) {
      log(`   ⚠️  Tool returned error`, colors.yellow);
    }
  } else if (message.error) {
    log(`\n❌ Error response (id: ${message.id})`, colors.red);
    log(`   Code: ${message.error.code}`, colors.red);
    log(`   Message: ${message.error.message}`, colors.red);
    if (message.error.data) {
      log(`   Data: ${JSON.stringify(message.error.data, null, 2)}`, colors.red);
    }
  }
}

// Helper function to wait
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Browser Command Helper Functions
// ============================================================================

async function navigateToUrl(url: string): Promise<void> {
  log(`\n🌐 Navigate to: ${url}`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'chrome_navigate',
      arguments: { url }
    }
  });
}

async function clickElement(selector: string): Promise<void> {
  log(`\n👆 Click element: ${selector}`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'chrome_click_element',
      arguments: { selector }
    }
  });
}

async function fillInput(selector: string, value: string): Promise<void> {
  log(`\n✍️  Fill input: ${selector} = "${value}"`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'chrome_fill_or_select',
      arguments: { selector, value }
    }
  });
}

async function takeScreenshot(fullPage: boolean = false): Promise<void> {
  log(`\n📸 Take screenshot (fullPage: ${fullPage})`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'chrome_screenshot',
      arguments: { fullPage, storeBase64: true }
    }
  });
}

async function readPage(filter: 'all' | 'interactive' = 'interactive'): Promise<void> {
  log(`\n📖 Read page (filter: ${filter})`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'chrome_read_page',
      arguments: { filter }
    }
  });
}

async function executeJavaScript(code: string): Promise<void> {
  log(`\n⚡ Execute JavaScript:`, colors.cyan);
  log(`   ${code}`, colors.bright);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'chrome_javascript',
      arguments: { code }
    }
  });
}

async function getWindowsAndTabs(): Promise<void> {
  log(`\n🪟 Get windows and tabs`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/call',
    params: {
      name: 'get_windows_and_tabs',
      arguments: {}
    }
  });
}

async function listTools(): Promise<void> {
  log(`\n🔧 List available tools`, colors.cyan);
  await sendMessage({
    jsonrpc: '2.0',
    id: generateId(),
    method: 'tools/list',
    params: {}
  });
}

// ============================================================================
// Test Scenarios
// ============================================================================

async function testScenario1() {
  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`TEST SCENARIO 1: Simple Navigation`, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);

  await navigateToUrl('https://example.com');
  await wait(2000);

  await takeScreenshot(false);
  await wait(1000);

  await readPage('interactive');
  await wait(1000);
}

async function testScenario2() {
  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`TEST SCENARIO 2: Form Interaction`, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);

  await navigateToUrl('https://httpbin.org/forms/post');
  await wait(2000);

  await fillInput('input[name="custname"]', 'John Doe');
  await wait(500);

  await fillInput('input[name="custtel"]', '555-1234');
  await wait(500);

  await fillInput('input[name="custemail"]', 'john@example.com');
  await wait(500);

  await takeScreenshot(true);
  await wait(1000);
}

async function testScenario3() {
  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`TEST SCENARIO 3: JavaScript Execution`, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);

  await navigateToUrl('https://example.com');
  await wait(2000);

  await executeJavaScript('document.title');
  await wait(500);

  await executeJavaScript('document.body.style.backgroundColor = "lightblue"');
  await wait(500);

  await takeScreenshot(false);
  await wait(1000);
}

async function testScenario4() {
  log(`\n${'='.repeat(60)}`, colors.bright);
  log(`TEST SCENARIO 4: Tab Management`, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);

  await getWindowsAndTabs();
  await wait(1000);

  await navigateToUrl('https://github.com');
  await wait(2000);

  await getWindowsAndTabs();
  await wait(1000);
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTests() {
  try {
    log(`\n${'='.repeat(60)}`, colors.bright);
    log(`🧪 BTCP SERVER TEST SCRIPT`, colors.bright);
    log(`${'='.repeat(60)}`, colors.bright);
    log(`Server: ${SERVER_URL}`, colors.cyan);
    log(`Session: ${SESSION_ID}`, colors.cyan);

    // Connect to SSE stream
    await connectSSE();
    await wait(1000);

    // List available tools first
    await listTools();
    await wait(2000);

    // Run test scenarios
    await testScenario1();
    await wait(2000);

    await testScenario2();
    await wait(2000);

    await testScenario3();
    await wait(2000);

    await testScenario4();
    await wait(2000);

    log(`\n${'='.repeat(60)}`, colors.green);
    log(`✅ All test scenarios completed!`, colors.green);
    log(`${'='.repeat(60)}`, colors.green);
    log(`\nPress Ctrl+C to exit...`, colors.cyan);

  } catch (error) {
    log(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    if (error instanceof Error && error.stack) {
      log(error.stack, colors.red);
    }
    process.exit(1);
  }
}

// Run tests
runTests();
