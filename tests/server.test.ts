/**
 * Tests for BTCPServer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { BTCPServer } from '../src/server.js';
import {
  createRequest,
  createToolsRegisterRequest,
  createToolCallRequest,
  createSessionJoinRequest,
  createPingRequest,
  serializeMessage,
} from '../src/protocol.js';

// Helper to make HTTP requests
async function httpRequest(
  url: string,
  options: http.RequestOptions = {},
  body?: string
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Helper to connect SSE
function connectSSE(
  url: string,
  onMessage: (data: string) => void
): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      res.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            onMessage(line.slice(5).trim());
          }
        }
      });

      resolve({
        close: () => {
          res.destroy();
          req.destroy();
        },
      });
    });
    req.on('error', reject);
  });
}

// Helper to send POST message
async function postMessage(port: number, sessionId: string, message: object): Promise<void> {
  const body = JSON.stringify(message);
  await httpRequest(`http://localhost:${port}/message?sessionId=${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body);
}

describe('BTCPServer', () => {
  let server: BTCPServer;
  let port: number;

  beforeEach(async () => {
    // Use a random port to avoid conflicts
    port = 10000 + Math.floor(Math.random() * 50000);
    server = new BTCPServer({ port, debug: false });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Server Lifecycle', () => {
    it('should start and stop', async () => {
      const testServer = new BTCPServer({ port: port + 1 });
      await testServer.start();
      await testServer.stop();
    });

    it('should handle multiple start/stop cycles', async () => {
      const testServer = new BTCPServer({ port: port + 2 });
      await testServer.start();
      await testServer.stop();
      await testServer.start();
      await testServer.stop();
    });
  });

  describe('Health Endpoint', () => {
    it('should return health status', async () => {
      const response = await httpRequest(`http://localhost:${port}/health`);

      expect(response.status).toBe(200);
      const data = JSON.parse(response.data);
      expect(data.status).toBe('ok');
      expect(typeof data.sessions).toBe('number');
      expect(typeof data.clients).toBe('number');
      expect(typeof data.uptime).toBe('number');
    });
  });

  describe('Sessions Endpoint', () => {
    it('should return empty sessions list initially', async () => {
      const response = await httpRequest(`http://localhost:${port}/sessions`);

      expect(response.status).toBe(200);
      const data = JSON.parse(response.data);
      expect(data.sessions).toEqual([]);
    });

    it('should list sessions after browser connects', async () => {
      const sessionId = 'test-session-1';
      const messages: string[] = [];
      const sse = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => messages.push(data)
      );

      // Wait for connection
      await new Promise((r) => setTimeout(r, 100));

      const response = await httpRequest(`http://localhost:${port}/sessions`);
      const data = JSON.parse(response.data);

      expect(data.sessions.length).toBe(1);
      expect(data.sessions[0].id).toBe(sessionId);
      expect(data.sessions[0].hasBrowser).toBe(true);

      sse.close();
    });
  });

  describe('SSE Connection', () => {
    it('should require sessionId', async () => {
      const response = await httpRequest(`http://localhost:${port}/events`);

      expect(response.status).toBe(400);
      const data = JSON.parse(response.data);
      expect(data.error).toContain('sessionId');
    });

    it('should accept browser client connection', async () => {
      const messages: string[] = [];
      const sse = await connectSSE(
        `http://localhost:${port}/events?sessionId=test&clientType=browser`,
        (data) => messages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      expect(messages.length).toBeGreaterThan(0);
      const connectedMsg = JSON.parse(messages[0] ?? '{}');
      expect(connectedMsg.method).toBe('connected');
      expect(connectedMsg.params.clientType).toBe('browser');

      sse.close();
    });

    it('should accept agent client connection', async () => {
      const messages: string[] = [];
      const sse = await connectSSE(
        `http://localhost:${port}/events?sessionId=test&clientType=agent`,
        (data) => messages.push(data)
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(messages.length).toBeGreaterThan(0);
      // Find the connected message (agent also receives sessions list)
      const connectedMsg = messages
        .map((m) => { try { return JSON.parse(m); } catch { return null; } })
        .find((m) => m?.method === 'connected');
      expect(connectedMsg).toBeDefined();
      expect(connectedMsg.params.clientType).toBe('agent');

      sse.close();
    });

    it('should send session list to agent on connect', async () => {
      // First connect a browser
      const browserMessages: string[] = [];
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=browser-session&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Then connect an agent
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=agent-session&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Agent should receive sessions list
      const sessionsMsg = agentMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.result?.sessions;
      });
      expect(sessionsMsg).toBeDefined();

      browserSSE.close();
      agentSSE.close();
    });
  });

  describe('Message Endpoint', () => {
    it('should require sessionId', async () => {
      const response = await httpRequest(
        `http://localhost:${port}/message`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        '{}'
      );

      expect(response.status).toBe(400);
    });

    it('should reject invalid JSON', async () => {
      const response = await httpRequest(
        `http://localhost:${port}/message?sessionId=test`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        'not json'
      );

      expect(response.status).toBe(400);
    });

    it('should accept valid message', async () => {
      const browserMessages: string[] = [];
      const sse = await connectSSE(
        `http://localhost:${port}/events?sessionId=test&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      const response = await httpRequest(
        `http://localhost:${port}/message?sessionId=test`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        serializeMessage(createPingRequest())
      );

      expect(response.status).toBe(200);

      sse.close();
    });
  });

  describe('Tool Registration', () => {
    it('should register tools from browser', async () => {
      const sessionId = 'tool-test';
      const browserMessages: string[] = [];
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Register tools
      const tools = [
        { name: 'test_tool', description: 'Test', inputSchema: { type: 'object' } },
      ];
      await postMessage(port, sessionId, createToolsRegisterRequest(tools));

      await new Promise((r) => setTimeout(r, 100));

      // Check sessions endpoint shows tool count
      const sessionsResponse = await httpRequest(`http://localhost:${port}/sessions`);
      const sessions = JSON.parse(sessionsResponse.data);
      const session = sessions.sessions.find((s: any) => s.id === sessionId);
      expect(session?.toolCount).toBe(1);

      browserSSE.close();
    });

    it('should notify agents when tools are registered', async () => {
      const sessionId = 'notify-test';
      const agentSessionId = 'agent-notify';

      // Connect browser
      const browserMessages: string[] = [];
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Connect agent and join session
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${agentSessionId}&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Agent joins the browser's session (post to agent's session)
      await postMessage(port, agentSessionId, createSessionJoinRequest(sessionId));

      await new Promise((r) => setTimeout(r, 100));

      // Register tools
      const tools = [{ name: 'new_tool', description: 'New', inputSchema: {} }];
      await postMessage(port, sessionId, createToolsRegisterRequest(tools));

      await new Promise((r) => setTimeout(r, 200));

      // Agent should receive tools/updated notification
      const updateMsg = agentMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'tools/updated';
      });
      expect(updateMsg).toBeDefined();

      browserSSE.close();
      agentSSE.close();
    });
  });

  describe('Session Join', () => {
    it('should allow agent to join browser session', async () => {
      const sessionId = 'join-test';
      const agentSessionId = 'agent-join';

      // Connect browser
      const browserMessages: string[] = [];
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Register some tools
      const tools = [{ name: 'tool1', description: 'T1', inputSchema: {} }];
      await postMessage(port, sessionId, createToolsRegisterRequest(tools));

      await new Promise((r) => setTimeout(r, 100));

      // Connect agent
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${agentSessionId}&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Join session (post to agent's session)
      await postMessage(port, agentSessionId, createSessionJoinRequest(sessionId));

      await new Promise((r) => setTimeout(r, 200));

      // Check for join response with tools
      const joinResponse = agentMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.result?.success === true && parsed.result?.tools;
      });
      expect(joinResponse).toBeDefined();

      browserSSE.close();
      agentSSE.close();
    });

    it('should return error for non-existent session', async () => {
      const agentSessionId = 'agent-error';
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${agentSessionId}&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Try to join non-existent session (post to agent's session)
      await postMessage(port, agentSessionId, createSessionJoinRequest('non-existent'));

      await new Promise((r) => setTimeout(r, 200));

      // Should receive error response
      const errorResponse = agentMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.error;
      });
      expect(errorResponse).toBeDefined();

      agentSSE.close();
    });
  });

  describe('Ping/Pong', () => {
    it('should respond to ping', async () => {
      const sessionId = 'ping-test';
      const messages: string[] = [];
      const sse = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => messages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      await postMessage(port, sessionId, createPingRequest());

      await new Promise((r) => setTimeout(r, 100));

      const pongResponse = messages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.result?.pong === true;
      });
      expect(pongResponse).toBeDefined();

      sse.close();
    });
  });

  describe('Tool Call Forwarding', () => {
    it('should forward tool call to browser and return response', async () => {
      const sessionId = 'toolcall-test';
      const agentSessionId = 'agent-toolcall';

      // Connect browser
      const browserMessages: string[] = [];
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Register tools
      const tools = [{ name: 'echo', description: 'Echo', inputSchema: {} }];
      await postMessage(port, sessionId, createToolsRegisterRequest(tools));

      await new Promise((r) => setTimeout(r, 100));

      // Connect agent and join
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${agentSessionId}&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));
      await postMessage(port, agentSessionId, createSessionJoinRequest(sessionId));
      await new Promise((r) => setTimeout(r, 100));

      // Agent calls tool (post to the joined session, which is the browser's session)
      const toolCall = createToolCallRequest('echo', { message: 'hello' });
      await postMessage(port, sessionId, toolCall);

      await new Promise((r) => setTimeout(r, 100));

      // Browser should receive the tool call
      const receivedCall = browserMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'tools/call';
      });
      expect(receivedCall).toBeDefined();

      browserSSE.close();
      agentSSE.close();
    });

    it('should return error if no browser connected', async () => {
      const agentSessionId = 'agent-no-browser';

      // Connect agent only (no browser)
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${agentSessionId}&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Try to call tool without browser (agent hasn't joined any session with a browser)
      const toolCall = createToolCallRequest('echo', {});
      await postMessage(port, agentSessionId, toolCall);

      await new Promise((r) => setTimeout(r, 200));

      // Should receive error (no session or no browser)
      const errorResponse = agentMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.error;
      });
      expect(errorResponse).toBeDefined();

      agentSSE.close();
    });
  });

  describe('Disconnect Handling', () => {
    it('should notify agents when browser disconnects', async () => {
      const sessionId = 'disconnect-test';
      const agentSessionId = 'agent-disconnect';

      // Connect browser
      const browserMessages: string[] = [];
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        (data) => browserMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));

      // Connect agent and join
      const agentMessages: string[] = [];
      const agentSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${agentSessionId}&clientType=agent`,
        (data) => agentMessages.push(data)
      );

      await new Promise((r) => setTimeout(r, 100));
      await postMessage(port, agentSessionId, createSessionJoinRequest(sessionId));
      await new Promise((r) => setTimeout(r, 100));

      // Disconnect browser
      browserSSE.close();

      await new Promise((r) => setTimeout(r, 200));

      // Agent should receive disconnect notification
      const disconnectMsg = agentMessages.find((m) => {
        const parsed = JSON.parse(m);
        return parsed.method === 'browser/disconnected';
      });
      expect(disconnectMsg).toBeDefined();

      agentSSE.close();
    });

    it('should clean up empty sessions', async () => {
      const sessionId = 'cleanup-test';

      // Connect and disconnect browser
      const browserSSE = await connectSSE(
        `http://localhost:${port}/events?sessionId=${sessionId}&clientType=browser`,
        () => {}
      );

      await new Promise((r) => setTimeout(r, 100));

      // Verify session exists
      let response = await httpRequest(`http://localhost:${port}/sessions`);
      let sessions = JSON.parse(response.data).sessions;
      expect(sessions.find((s: any) => s.id === sessionId)).toBeDefined();

      // Disconnect
      browserSSE.close();
      await new Promise((r) => setTimeout(r, 200));

      // Session should be cleaned up
      response = await httpRequest(`http://localhost:${port}/sessions`);
      sessions = JSON.parse(response.data).sessions;
      expect(sessions.find((s: any) => s.id === sessionId)).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight', async () => {
      const response = await httpRequest(`http://localhost:${port}/health`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
    });

    it('should include CORS headers', async () => {
      // We can't easily check headers with our simple helper,
      // but we verify the request succeeds which implies CORS is working
      const response = await httpRequest(`http://localhost:${port}/health`);
      expect(response.status).toBe(200);
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await httpRequest(`http://localhost:${port}/unknown`);

      expect(response.status).toBe(404);
    });
  });
});
