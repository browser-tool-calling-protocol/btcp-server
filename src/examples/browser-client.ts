/**
 * Example: Browser Client Usage
 *
 * This example demonstrates how to use the BTCP client in a browser context
 * (or browser extension) to provide tools to AI agents.
 *
 * Run the server first: npm run start:server
 * Then run this client: npx ts-node src/examples/browser-client.ts
 */

import { BTCPClient } from '../client.js';
import type { BTCPToolDefinition, BrowserAgent } from '../types.js';

// Example: Mock browser agent for Node.js testing
// In a real browser, this would interact with the actual DOM
const mockBrowserAgent: BrowserAgent = {
  async snapshot() {
    return `
      <html>
        <head><title>Example Page</title></head>
        <body>
          <h1>Welcome to BTCP</h1>
          <p>This is a mock page snapshot.</p>
          <button id="submit">Submit</button>
          <input id="email" type="text" value="test@example.com" />
        </body>
      </html>
    `;
  },
  async click(selector: string) {
    console.log(`[MockAgent] Clicked: ${selector}`);
  },
  async fill(selector: string, value: string) {
    console.log(`[MockAgent] Filled ${selector} with: ${value}`);
  },
  async type(text: string) {
    console.log(`[MockAgent] Typed: ${text}`);
  },
  async hover(selector: string) {
    console.log(`[MockAgent] Hovered: ${selector}`);
  },
  async press(key: string) {
    console.log(`[MockAgent] Pressed: ${key}`);
  },
  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number) {
    console.log(`[MockAgent] Scrolled ${direction} by ${amount ?? 'default'}`);
  },
  async getText(selector: string) {
    return `Text content of ${selector}`;
  },
  async getAttribute(selector: string, attribute: string) {
    return `${attribute}-value`;
  },
  async isVisible(selector: string) {
    return true;
  },
  async getUrl() {
    return 'https://example.com/page';
  },
  async getTitle() {
    return 'Example Page';
  },
  async screenshot() {
    // Return a tiny 1x1 transparent PNG for testing
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  },
  async wait(timeout: number) {
    await new Promise((resolve) => setTimeout(resolve, timeout));
  },
  async evaluate(script: string) {
    console.log(`[MockAgent] Evaluating: ${script}`);
    return { result: 'evaluated' };
  },
};

async function main() {
  const sessionId = process.argv[2] || `session-${Date.now()}`;

  console.log('='.repeat(50));
  console.log('BTCP Browser Client Example');
  console.log('='.repeat(50));
  console.log(`Session ID: ${sessionId}`);
  console.log('');

  // Create client
  const client = new BTCPClient({
    serverUrl: 'http://localhost:8765',
    sessionId,
    debug: true,
    autoReconnect: true,
  });

  // Set up browser agent
  client.setBrowserAgent(mockBrowserAgent);

  // Add custom tools
  const executor = client.getExecutor();

  // Custom tool: Get current timestamp
  executor.registerHandler(
    'get_timestamp',
    async () => {
      return { timestamp: Date.now(), iso: new Date().toISOString() };
    },
    {
      name: 'get_timestamp',
      description: 'Get the current timestamp',
      inputSchema: { type: 'object', properties: {} },
    }
  );

  // Custom tool: Calculate expression
  executor.registerHandler(
    'calculate',
    async (args) => {
      const expression = String(args['expression'] || '');
      // Simple and safe expression evaluation
      const result = Function(`'use strict'; return (${expression})`)();
      return { expression, result };
    },
    {
      name: 'calculate',
      description: 'Calculate a mathematical expression',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate',
          },
        },
        required: ['expression'],
      },
    }
  );

  // Event handlers
  client.on('connect', () => {
    console.log('[Event] Connected to server');
  });

  client.on('disconnect', (code, reason) => {
    console.log(`[Event] Disconnected: ${code} - ${reason}`);
  });

  client.on('error', (error) => {
    console.error('[Event] Error:', error.message);
  });

  client.on('toolCall', (request) => {
    console.log(`[Event] Tool called: ${request.params.name}`);
  });

  try {
    // Connect to server
    console.log('Connecting to server...');
    await client.connect();

    // Register tools
    console.log('Registering tools...');
    await client.registerTools();

    const tools = executor.getToolDefinitions();
    console.log(`\nRegistered ${tools.length} tools:`);
    tools.forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });

    console.log('\n' + '='.repeat(50));
    console.log('Client is running. Waiting for tool calls...');
    console.log('Press Ctrl+C to exit.');
    console.log('='.repeat(50) + '\n');

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\nDisconnecting...');
      client.disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start client:', error);
    process.exit(1);
  }
}

main();
