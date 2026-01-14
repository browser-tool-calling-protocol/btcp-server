/**
 * Integration tests - Full end-to-end testing of BTCP protocol
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { BTCPClient } from '../src/client.js';
import { BTCPServer } from '../src/server.js';
import {
  createToolCallRequest,
  createSessionJoinRequest,
  createToolsListRequest,
  parseMessage,
  serializeMessage,
} from '../src/protocol.js';
import type { BrowserAgent, JsonRpcResponse } from '../src/types.js';

// Helper to connect an agent via SSE and send messages
class AgentHelper {
  private messages: string[] = [];
  private sseConnection: { close: () => void } | null = null;
  private port: number;
  private sessionId: string;
  private joinedSessionId: string | null = null;
  private clientId: string | null = null;
  private pendingResponses = new Map<string | number, (response: JsonRpcResponse) => void>();

  constructor(port: number, sessionId: string) {
    this.port = port;
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `http://localhost:${this.port}/events?sessionId=${this.sessionId}&clientType=agent`;
      const req = http.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (data) {
                this.messages.push(data);
                this.handleMessage(data);

                // Extract clientId from connected message
                try {
                  const msg = parseMessage(data);
                  if ('method' in msg && msg.method === 'connected' && msg.params) {
                    this.clientId = (msg.params as { clientId: string }).clientId;
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        });

        this.sseConnection = {
          close: () => {
            res.destroy();
            req.destroy();
          },
        };

        // Wait for connection message
        setTimeout(resolve, 100);
      });
      req.on('error', reject);
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = parseMessage(data);
      if ('id' in message && !('method' in message)) {
        // It's a response
        const handler = this.pendingResponses.get(message.id);
        if (handler) {
          this.pendingResponses.delete(message.id);
          handler(message as JsonRpcResponse);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  async sendRequest(message: object, overrideSessionId?: string): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = (message as any).id;
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error('Request timeout'));
      }, 5000);

      this.pendingResponses.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      const body = serializeMessage(message as any);
      // After joining a session, use the joined session ID for subsequent requests
      const effectiveSessionId = overrideSessionId ?? this.joinedSessionId ?? this.sessionId;
      // Include clientId in POST for proper routing
      let url = `http://localhost:${this.port}/message?sessionId=${effectiveSessionId}`;
      if (this.clientId) {
        url += `&clientId=${this.clientId}`;
      }

      const urlObj = new URL(url);
      const req = http.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          this.pendingResponses.delete(id);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        this.pendingResponses.delete(id);
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  // Join a session and track the joined session ID
  async joinSession(targetSessionId: string): Promise<JsonRpcResponse> {
    const joinRequest = createSessionJoinRequest(targetSessionId);
    // Use the agent's own session ID when sending the join request
    const response = await this.sendRequest(joinRequest, this.sessionId);
    if (response.result && (response.result as any).success) {
      this.joinedSessionId = targetSessionId;
    }
    return response;
  }

  disconnect(): void {
    this.sseConnection?.close();
  }

  getMessages(): string[] {
    return this.messages;
  }
}

describe('Integration Tests', () => {
  let server: BTCPServer;
  let browserClient: BTCPClient;
  let port: number;

  beforeEach(async () => {
    port = 10000 + Math.floor(Math.random() * 50000);
    server = new BTCPServer({ port, debug: false });
    await server.start();
  });

  afterEach(async () => {
    if (browserClient?.isConnected()) {
      browserClient.disconnect();
    }
    await server.stop();
  });

  describe('Full Tool Execution Flow', () => {
    it('should execute echo tool from agent to browser', async () => {
      const sessionId = 'integration-echo-test';

      // Connect browser client
      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      // Connect agent
      const agent = new AgentHelper(port, 'agent-1');
      await agent.connect();

      // Agent joins session
      const joinResponse = await agent.joinSession(sessionId);
      expect(joinResponse.result).toBeDefined();

      // Agent calls echo tool
      const toolCall = createToolCallRequest('echo', { message: 'Hello from agent!' });
      const toolResponse = await agent.sendRequest(toolCall);

      expect(toolResponse.result).toBeDefined();
      const result = toolResponse.result as { content: Array<{ type: string; text: string }> };
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Hello from agent!');

      agent.disconnect();
    });

    it('should execute evaluate tool', async () => {
      const sessionId = 'integration-eval-test';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-2');
      await agent.connect();

      await agent.joinSession(sessionId);

      const toolCall = createToolCallRequest('evaluate', { code: '2 + 2' });
      const toolResponse = await agent.sendRequest(toolCall);

      const result = toolResponse.result as { content: Array<{ type: string; text: string }> };
      expect(JSON.parse(result.content[0]?.text ?? '')).toBe(4);

      agent.disconnect();
    });

    it('should execute custom tool', async () => {
      const sessionId = 'integration-custom-test';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      // Register custom tool
      const executor = browserClient.getExecutor();
      executor.registerHandler(
        'greet',
        async (args) => {
          const name = args['name'] ?? 'World';
          return `Hello, ${name}!`;
        },
        {
          name: 'greet',
          description: 'Greet someone',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        }
      );

      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-3');
      await agent.connect();
      await agent.joinSession(sessionId);

      const toolCall = createToolCallRequest('greet', { name: 'BTCP' });
      const toolResponse = await agent.sendRequest(toolCall);

      const result = toolResponse.result as { content: Array<{ type: string; text: string }> };
      expect(result.content[0]?.text).toBe('Hello, BTCP!');

      agent.disconnect();
    });

    it('should handle tool not found error', async () => {
      const sessionId = 'integration-notfound-test';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-4');
      await agent.connect();
      await agent.joinSession(sessionId);

      const toolCall = createToolCallRequest('nonexistent_tool', {});
      const toolResponse = await agent.sendRequest(toolCall);

      expect(toolResponse.result).toBeDefined();
      const result = toolResponse.result as { isError: boolean };
      expect(result.isError).toBe(true);

      agent.disconnect();
    });

    it('should handle tool execution error', async () => {
      const sessionId = 'integration-error-test';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      const executor = browserClient.getExecutor();
      executor.registerHandler(
        'failing_tool',
        async () => {
          throw new Error('Tool failed intentionally');
        },
        { name: 'failing_tool', description: 'Fails', inputSchema: {} }
      );

      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-5');
      await agent.connect();
      await agent.joinSession(sessionId);

      const toolCall = createToolCallRequest('failing_tool', {});
      const toolResponse = await agent.sendRequest(toolCall);

      const result = toolResponse.result as { isError: boolean };
      expect(result.isError).toBe(true);

      agent.disconnect();
    });
  });

  describe('Tool Discovery', () => {
    it('should list available tools', async () => {
      const sessionId = 'integration-list-test';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      const executor = browserClient.getExecutor();
      executor.registerHandler(
        'custom_tool',
        async () => 'result',
        {
          name: 'custom_tool',
          description: 'A custom tool for testing',
          inputSchema: { type: 'object' },
        }
      );

      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-6');
      await agent.connect();
      await agent.joinSession(sessionId);

      const listRequest = createToolsListRequest();
      const listResponse = await agent.sendRequest(listRequest);

      const result = listResponse.result as { tools: Array<{ name: string; description: string }> };
      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      const customTool = result.tools.find((t) => t.name === 'custom_tool');
      expect(customTool).toBeDefined();
      expect(customTool?.description).toBe('A custom tool for testing');

      agent.disconnect();
    });
  });

  describe('Browser Agent Tools', () => {
    it('should execute browser tools via agent', async () => {
      const sessionId = 'integration-browser-agent-test';

      const mockAgent: BrowserAgent = {
        snapshot: vi.fn().mockResolvedValue('<html><body>Test Page</body></html>'),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        hover: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        scroll: vi.fn().mockResolvedValue(undefined),
        getText: vi.fn().mockResolvedValue('Button text'),
        getAttribute: vi.fn().mockResolvedValue('btn-primary'),
        isVisible: vi.fn().mockResolvedValue(true),
        getUrl: vi.fn().mockResolvedValue('https://example.com/page'),
        getTitle: vi.fn().mockResolvedValue('Example Page Title'),
        screenshot: vi.fn().mockResolvedValue('iVBORw0KGgoAAAANSUhEUgAAAAE='),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({ computed: 'value' }),
      };

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      browserClient.setBrowserAgent(mockAgent);
      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-7');
      await agent.connect();
      await agent.joinSession(sessionId);

      // Test browser_snapshot
      const snapshotCall = createToolCallRequest('browser_snapshot', {});
      const snapshotResponse = await agent.sendRequest(snapshotCall);
      const snapshotResult = snapshotResponse.result as { content: Array<{ text: string }> };
      expect(snapshotResult.content[0]?.text).toContain('Test Page');
      expect(mockAgent.snapshot).toHaveBeenCalled();

      // Test browser_click
      const clickCall = createToolCallRequest('browser_click', { selector: '#submit' });
      await agent.sendRequest(clickCall);
      expect(mockAgent.click).toHaveBeenCalledWith('#submit');

      // Test browser_fill
      const fillCall = createToolCallRequest('browser_fill', { selector: '#email', value: 'test@test.com' });
      await agent.sendRequest(fillCall);
      expect(mockAgent.fill).toHaveBeenCalledWith('#email', 'test@test.com');

      // Test browser_get_title
      const titleCall = createToolCallRequest('browser_get_title', {});
      const titleResponse = await agent.sendRequest(titleCall);
      const titleResult = titleResponse.result as { content: Array<{ text: string }> };
      expect(titleResult.content[0]?.text).toBe('Example Page Title');

      // Test browser_get_url
      const urlCall = createToolCallRequest('browser_get_url', {});
      const urlResponse = await agent.sendRequest(urlCall);
      const urlResult = urlResponse.result as { content: Array<{ text: string }> };
      expect(urlResult.content[0]?.text).toBe('https://example.com/page');

      agent.disconnect();
    });
  });

  describe('Multiple Agents', () => {
    it('should support multiple agents in same session', async () => {
      const sessionId = 'integration-multi-agent-test';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      // Connect first agent
      const agent1 = new AgentHelper(port, 'agent-a');
      await agent1.connect();
      await agent1.joinSession(sessionId);

      // Connect second agent
      const agent2 = new AgentHelper(port, 'agent-b');
      await agent2.connect();
      await agent2.joinSession(sessionId);

      // Both agents call tools
      const call1 = createToolCallRequest('echo', { message: 'Agent 1' });
      const call2 = createToolCallRequest('echo', { message: 'Agent 2' });

      const [response1, response2] = await Promise.all([
        agent1.sendRequest(call1),
        agent2.sendRequest(call2),
      ]);

      const result1 = response1.result as { content: Array<{ text: string }> };
      const result2 = response2.result as { content: Array<{ text: string }> };

      expect(result1.content[0]?.text).toBe('Agent 1');
      expect(result2.content[0]?.text).toBe('Agent 2');

      agent1.disconnect();
      agent2.disconnect();
    });
  });

  describe('Session Management', () => {
    it('should handle browser reconnection', async () => {
      const sessionId = 'integration-reconnect-test';

      // Connect first browser
      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      // Connect agent
      const agent = new AgentHelper(port, 'agent-8');
      await agent.connect();
      await agent.joinSession(sessionId);

      // Verify tool works
      let toolCall = createToolCallRequest('echo', { message: 'Before' });
      let response = await agent.sendRequest(toolCall);
      let result = response.result as { content: Array<{ text: string }> };
      expect(result.content[0]?.text).toBe('Before');

      // Disconnect browser
      browserClient.disconnect();

      // Wait a bit
      await new Promise((r) => setTimeout(r, 100));

      // Connect new browser with same session
      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      // Verify tool still works
      toolCall = createToolCallRequest('echo', { message: 'After' });
      response = await agent.sendRequest(toolCall);
      result = response.result as { content: Array<{ text: string }> };
      expect(result.content[0]?.text).toBe('After');

      agent.disconnect();
    });
  });

  describe('Content Types', () => {
    it('should handle text content', async () => {
      const sessionId = 'integration-text-content';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      browserClient.getExecutor().registerHandler(
        'text_tool',
        async () => ({ type: 'text', text: 'Plain text response' }),
        { name: 'text_tool', description: 'Returns text', inputSchema: {} }
      );

      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-9');
      await agent.connect();
      await agent.joinSession(sessionId);

      const call = createToolCallRequest('text_tool', {});
      const response = await agent.sendRequest(call);
      const result = response.result as { content: Array<{ type: string; text: string }> };

      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Plain text response');

      agent.disconnect();
    });

    it('should handle image content', async () => {
      const sessionId = 'integration-image-content';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      browserClient.getExecutor().registerHandler(
        'image_tool',
        async () => ({
          type: 'image',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
          mimeType: 'image/png',
        }),
        { name: 'image_tool', description: 'Returns image', inputSchema: {} }
      );

      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-10');
      await agent.connect();
      await agent.joinSession(sessionId);

      const call = createToolCallRequest('image_tool', {});
      const response = await agent.sendRequest(call);
      const result = response.result as { content: Array<{ type: string; mimeType: string }> };

      expect(result.content[0]?.type).toBe('image');
      expect(result.content[0]?.mimeType).toBe('image/png');

      agent.disconnect();
    });

    it('should handle multiple content items', async () => {
      const sessionId = 'integration-multi-content';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });

      browserClient.getExecutor().registerHandler(
        'multi_tool',
        async () => [
          { type: 'text', text: 'First item' },
          { type: 'text', text: 'Second item' },
          { type: 'text', text: 'Third item' },
        ],
        { name: 'multi_tool', description: 'Returns multiple items', inputSchema: {} }
      );

      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-11');
      await agent.connect();
      await agent.joinSession(sessionId);

      const call = createToolCallRequest('multi_tool', {});
      const response = await agent.sendRequest(call);
      const result = response.result as { content: Array<{ type: string; text: string }> };

      expect(result.content.length).toBe(3);
      expect(result.content[0]?.text).toBe('First item');
      expect(result.content[1]?.text).toBe('Second item');
      expect(result.content[2]?.text).toBe('Third item');

      agent.disconnect();
    });
  });

  describe('Performance', () => {
    it('should handle rapid sequential tool calls', async () => {
      const sessionId = 'integration-rapid-calls';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-12');
      await agent.connect();
      await agent.joinSession(sessionId);

      const callCount = 10;
      const results: string[] = [];

      for (let i = 0; i < callCount; i++) {
        const call = createToolCallRequest('echo', { message: `Call ${i}` });
        const response = await agent.sendRequest(call);
        const result = response.result as { content: Array<{ text: string }> };
        results.push(result.content[0]?.text ?? '');
      }

      expect(results.length).toBe(callCount);
      for (let i = 0; i < callCount; i++) {
        expect(results[i]).toBe(`Call ${i}`);
      }

      agent.disconnect();
    });

    it('should handle concurrent tool calls', async () => {
      const sessionId = 'integration-concurrent-calls';

      browserClient = new BTCPClient({
        serverUrl: `http://localhost:${port}`,
        sessionId,
        debug: false,
      });
      await browserClient.connect();
      await browserClient.registerTools();

      const agent = new AgentHelper(port, 'agent-13');
      await agent.connect();
      await agent.joinSession(sessionId);

      const callCount = 5;
      const promises = [];

      for (let i = 0; i < callCount; i++) {
        const call = createToolCallRequest('echo', { message: `Concurrent ${i}` });
        promises.push(agent.sendRequest(call));
      }

      const responses = await Promise.all(promises);

      expect(responses.length).toBe(callCount);
      for (const response of responses) {
        const result = response.result as { content: Array<{ text: string }> };
        expect(result.content[0]?.text).toMatch(/^Concurrent \d$/);
      }

      agent.disconnect();
    });
  });
});
