/**
 * Example: Agent Client Usage
 *
 * This example demonstrates how an AI agent can connect to the BTCP server
 * to discover and call tools provided by browser clients.
 *
 * Run the server first: npm run start:server
 * Run a browser client: npx ts-node src/examples/browser-client.ts <session-id>
 * Then run this agent: npx ts-node src/examples/agent-client.ts <session-id>
 */

import http from 'http';
import {
  createRequest,
  createSessionJoinRequest,
  createToolsListRequest,
  createToolCallRequest,
  parseMessage,
  serializeMessage,
  generateMessageId,
  isResponse,
} from '../protocol.js';
import type { JsonRpcMessage, JsonRpcResponse, BTCPToolDefinition } from '../types.js';

const SERVER_URL = 'http://localhost:8765';

/**
 * Simple HTTP client for sending POST requests
 */
async function postMessage(sessionId: string, message: JsonRpcMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = serializeMessage(message);
    const url = new URL(`${SERVER_URL}/message?sessionId=${sessionId}`);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Connect to server via SSE and handle messages
 */
function connectSSE(
  sessionId: string,
  onMessage: (message: JsonRpcMessage) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${SERVER_URL}/events?sessionId=${sessionId}&clientType=agent`;

    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      console.log('[SSE] Connected to server');
      resolve();

      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const message = parseMessage(data);
                onMessage(message);
              } catch (error) {
                console.error('[SSE] Parse error:', error);
              }
            }
          }
        }
      });

      res.on('end', () => {
        console.log('[SSE] Connection closed');
      });
    }).on('error', reject);
  });
}

async function main() {
  const targetSessionId = process.argv[2];

  if (!targetSessionId) {
    console.log('Usage: npx ts-node src/examples/agent-client.ts <session-id>');
    console.log('\nFirst, start a browser client with:');
    console.log('  npx ts-node src/examples/browser-client.ts my-session');
    console.log('\nThen connect this agent with:');
    console.log('  npx ts-node src/examples/agent-client.ts my-session');
    process.exit(1);
  }

  console.log('='.repeat(50));
  console.log('BTCP Agent Client Example');
  console.log('='.repeat(50));
  console.log(`Target Session: ${targetSessionId}`);
  console.log('');

  // Create a temporary session for the agent
  const agentSessionId = `agent-${Date.now()}`;
  const pendingResponses = new Map<string | number, (response: JsonRpcResponse) => void>();
  let tools: BTCPToolDefinition[] = [];

  // Message handler
  const handleMessage = (message: JsonRpcMessage) => {
    console.log('[Received]', JSON.stringify(message, null, 2));

    if (isResponse(message)) {
      const handler = pendingResponses.get(message.id);
      if (handler) {
        pendingResponses.delete(message.id);
        handler(message);
      }
    }
  };

  // Helper to send request and wait for response
  const request = async (message: JsonRpcMessage): Promise<JsonRpcResponse> => {
    return new Promise((resolve, reject) => {
      const id = (message as { id?: string | number }).id ?? generateMessageId();

      const timeout = setTimeout(() => {
        pendingResponses.delete(id);
        reject(new Error('Request timeout'));
      }, 30000);

      pendingResponses.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      postMessage(targetSessionId, message).catch((error) => {
        clearTimeout(timeout);
        pendingResponses.delete(id);
        reject(error);
      });
    });
  };

  try {
    // Connect to server
    console.log('Connecting to server...');
    await connectSSE(agentSessionId, handleMessage);

    // Join the target session
    console.log(`\nJoining session: ${targetSessionId}`);
    const joinRequest = createSessionJoinRequest(targetSessionId);
    const joinResponse = await request(joinRequest);

    if (joinResponse.error) {
      console.error('Failed to join session:', joinResponse.error.message);
      process.exit(1);
    }

    const joinResult = joinResponse.result as { success: boolean; tools?: BTCPToolDefinition[] };
    if (joinResult.tools) {
      tools = joinResult.tools;
    }

    console.log('Joined session successfully!');

    // List available tools
    console.log('\nListing available tools...');
    const listRequest = createToolsListRequest();
    const listResponse = await request(listRequest);

    if (listResponse.result) {
      const result = listResponse.result as { tools: BTCPToolDefinition[] };
      tools = result.tools || tools;
    }

    console.log(`\nAvailable tools (${tools.length}):`);
    tools.forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
      if (tool.capabilities?.length) {
        console.log(`    Capabilities: ${tool.capabilities.join(', ')}`);
      }
    });

    // Demo: Call some tools
    console.log('\n' + '='.repeat(50));
    console.log('Calling tools...');
    console.log('='.repeat(50));

    // Call echo tool
    console.log('\n1. Calling echo tool...');
    const echoRequest = createToolCallRequest('echo', { message: 'Hello from the agent!' });
    const echoResponse = await request(echoRequest);
    console.log('Echo result:', JSON.stringify(echoResponse.result, null, 2));

    // Call get_timestamp tool
    console.log('\n2. Calling get_timestamp tool...');
    const timestampRequest = createToolCallRequest('get_timestamp', {});
    const timestampResponse = await request(timestampRequest);
    console.log('Timestamp result:', JSON.stringify(timestampResponse.result, null, 2));

    // Call calculate tool
    console.log('\n3. Calling calculate tool...');
    const calcRequest = createToolCallRequest('calculate', { expression: '2 + 2 * 10' });
    const calcResponse = await request(calcRequest);
    console.log('Calculate result:', JSON.stringify(calcResponse.result, null, 2));

    // Call browser_get_title tool
    console.log('\n4. Calling browser_get_title tool...');
    const titleRequest = createToolCallRequest('browser_get_title', {});
    const titleResponse = await request(titleRequest);
    console.log('Title result:', JSON.stringify(titleResponse.result, null, 2));

    // Call browser_snapshot tool
    console.log('\n5. Calling browser_snapshot tool...');
    const snapshotRequest = createToolCallRequest('browser_snapshot', {});
    const snapshotResponse = await request(snapshotRequest);
    console.log('Snapshot result:', JSON.stringify(snapshotResponse.result, null, 2));

    console.log('\n' + '='.repeat(50));
    console.log('All tool calls completed successfully!');
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
