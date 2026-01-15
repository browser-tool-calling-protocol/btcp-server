/**
 * BTCP Server - HTTP Streaming relay server for Browser Tool Calling Protocol
 *
 * This server acts as a relay between:
 * - Browser clients (provide and execute tools)
 * - AI Agents (discover and call tools)
 *
 * Communication uses:
 * - SSE (Server-Sent Events) for server-to-client messages
 * - HTTP POST for client-to-server messages
 */

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type {
  BTCPServerConfig,
  BTCPToolDefinition,
  SSEClient,
  Session,
  PendingResponse,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcMessage,
} from './types.js';
import {
  parseMessage,
  serializeMessage,
  createResponse,
  createErrorResponse,
  createPongResponse,
  isRequest,
  isResponse,
  generateMessageId,
} from './protocol.js';
import { ErrorCodes } from './errors.js';

/**
 * BTCP Server class - manages sessions and routes messages
 */
export class BTCPServer {
  private config: Required<BTCPServerConfig>;
  private server: http.Server;
  private sessions: Map<string, Session> = new Map();
  private clients: Map<string, SSEClient> = new Map();
  private keepAliveIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(config: BTCPServerConfig = {}) {
    this.config = {
      port: config.port ?? 8765,
      host: config.host ?? '0.0.0.0',
      debug: config.debug ?? false,
      keepAliveInterval: config.keepAliveInterval ?? 30000,
      requestTimeout: config.requestTimeout ?? 30000,
    };

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  /**
   * Start the server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.log(`Server listening on http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Clear all keep-alive intervals
      for (const interval of this.keepAliveIntervals.values()) {
        clearInterval(interval);
      }
      this.keepAliveIntervals.clear();

      // Close all SSE connections
      for (const client of this.clients.values()) {
        client.response.end();
      }
      this.clients.clear();
      this.sessions.clear();

      this.server.close(() => {
        this.log('Server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP request
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/events' && req.method === 'GET') {
      this.handleSSE(req, res, url.searchParams);
    } else if (pathname === '/message' && req.method === 'POST') {
      this.handleMessage(req, res, url.searchParams);
    } else if (pathname === '/health' && req.method === 'GET') {
      this.handleHealth(res);
    } else if (pathname === '/sessions' && req.method === 'GET') {
      this.handleSessionsList(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  /**
   * Handle SSE connection
   */
  private handleSSE(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void {
    const sessionId = params.get('sessionId');
    const clientType = params.get('clientType') as 'browser' | 'agent' | null;
    const clientId = generateMessageId();

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'sessionId is required' }));
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Create client
    const client: SSEClient = {
      id: clientId,
      type: clientType ?? 'agent',
      response: res,
      sessionId,
    };

    this.clients.set(clientId, client);
    this.log(`Client connected: ${clientId} (${client.type}) to session ${sessionId}`);

    // Handle session
    if (client.type === 'browser') {
      this.handleBrowserConnect(client);
    } else {
      this.handleAgentConnect(client);
    }

    // Set up keep-alive
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, this.config.keepAliveInterval);
    this.keepAliveIntervals.set(clientId, keepAlive);

    // Handle disconnect
    req.on('close', () => {
      this.handleDisconnect(clientId);
    });

    // Send connection confirmation
    this.sendToClient(client, {
      jsonrpc: '2.0',
      method: 'connected',
      params: {
        clientId,
        sessionId,
        clientType: client.type,
      },
    } as JsonRpcMessage);
  }

  /**
   * Handle browser client connection
   */
  private handleBrowserConnect(client: SSEClient): void {
    let session = this.sessions.get(client.sessionId);

    if (!session) {
      // Create new session
      session = {
        id: client.sessionId,
        browserClient: client,
        agentClients: new Map(),
        tools: [],
        pendingResponses: new Map(),
        createdAt: new Date(),
      };
      this.sessions.set(client.sessionId, session);
      this.log(`Session created: ${client.sessionId}`);
    } else {
      // Update existing session with new browser client
      if (session.browserClient) {
        // Disconnect old browser client
        this.sendToClient(session.browserClient, createErrorResponse(
          'disconnect',
          ErrorCodes.SESSION_ERROR,
          'Another browser client connected to this session'
        ));
        session.browserClient.response.end();
      }
      session.browserClient = client;
      this.log(`Browser client updated for session: ${client.sessionId}`);
    }
  }

  /**
   * Handle agent client connection
   */
  private handleAgentConnect(client: SSEClient): void {
    // Send list of available sessions
    const sessions = Array.from(this.sessions.entries())
      .filter(([, s]) => s.browserClient !== null)
      .map(([id, s]) => ({
        id,
        toolCount: s.tools.length,
        createdAt: s.createdAt.toISOString(),
      }));

    this.sendToClient(client, createResponse('sessions', { sessions }));
  }

  /**
   * Handle incoming message via POST
   */
  private handleMessage(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): void {
    const sessionId = params.get('sessionId');
    const clientId = params.get('clientId');

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'sessionId is required' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const message = parseMessage(body);
        this.log(`Message received for session ${sessionId} from client ${clientId}`, message);
        this.routeMessage(sessionId, message, clientId ?? undefined);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Invalid message',
        }));
      }
    });
  }

  /**
   * Find the sender client by client ID or fall back to session-based lookup
   */
  private findSenderClient(sessionId: string, clientId?: string): SSEClient | undefined {
    // If clientId is provided, use it directly
    if (clientId) {
      return this.clients.get(clientId);
    }

    const session = this.sessions.get(sessionId);

    // First, check if an agent in this session sent the message
    // Agents post to the joined session's ID
    if (session) {
      // Return the most recently active agent (simplification)
      for (const agent of session.agentClients.values()) {
        return agent;
      }
    }

    // Check if this is a client's own session (for initial connection messages)
    for (const client of this.clients.values()) {
      if (client.sessionId === sessionId) {
        return client;
      }
    }

    return undefined;
  }

  /**
   * Route a message to appropriate handler
   */
  private routeMessage(sessionId: string, message: JsonRpcMessage, clientId?: string): void {
    const session = this.sessions.get(sessionId);
    const senderClient = this.findSenderClient(sessionId, clientId);

    if (isResponse(message)) {
      // Handle response (from browser to agent)
      this.handleToolResponse(session, message);
      return;
    }

    if (!isRequest(message)) {
      return;
    }

    const { method } = message;

    switch (method) {
      case 'tools/register':
        this.handleToolsRegister(session, message);
        break;

      case 'tools/list':
        this.handleToolsList(session, message, senderClient);
        break;

      case 'tools/call':
        this.handleToolsCall(session, message, senderClient);
        break;

      case 'session/join':
        this.handleSessionJoin(sessionId, message, clientId);
        break;

      case 'ping':
        this.handlePing(session, message, senderClient);
        break;

      default:
        this.log(`Unknown method: ${method}`);
    }
  }

  /**
   * Handle tools/register request
   */
  private handleToolsRegister(session: Session | undefined, request: JsonRpcRequest): void {
    if (!session || !session.browserClient) {
      return;
    }

    const { tools } = request.params as { tools: BTCPToolDefinition[] };
    session.tools = tools;
    this.log(`Registered ${tools.length} tools for session ${session.id}`);

    // Notify all connected agents
    for (const agent of session.agentClients.values()) {
      this.sendToClient(agent, {
        jsonrpc: '2.0',
        method: 'tools/updated',
        params: { tools },
      } as JsonRpcMessage);
    }

    // Send acknowledgment to browser
    this.sendToClient(session.browserClient, createResponse(request.id, {
      success: true,
      registered: tools.length,
    }));
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(session: Session | undefined, request: JsonRpcRequest, senderClient?: SSEClient): void {
    if (!session) {
      // No session - return empty tools list or error
      if (senderClient) {
        this.sendToClient(senderClient, createResponse(request.id, { tools: [] }));
      }
      return;
    }

    // Forward to browser if connected, otherwise return cached tools
    if (session.browserClient) {
      // Store mapping for response routing (same pattern as tools/call)
      const internalId = generateMessageId();
      const agentId = senderClient?.id ?? '';

      session.pendingResponses.set(internalId, {
        agentId,
        originalId: request.id,
        timestamp: Date.now(),
      });

      // Forward to browser with internal ID
      const forwardedRequest: JsonRpcRequest = {
        ...request,
        id: internalId,
      };
      this.sendToClient(session.browserClient, forwardedRequest);

      // Set timeout for response
      setTimeout(() => {
        const pending = session.pendingResponses.get(internalId);
        if (pending) {
          session.pendingResponses.delete(internalId);
          const agent = session.agentClients.get(pending.agentId);
          if (agent) {
            // Return cached tools on timeout
            this.sendToClient(agent, createResponse(pending.originalId, { tools: session.tools }));
          }
        }
      }, this.config.requestTimeout);
    } else {
      // Return cached tools if no browser connected
      const response = createResponse(request.id, { tools: session.tools });
      if (senderClient) {
        this.sendToClient(senderClient, response);
      } else {
        // Fallback: find the agent that sent this request and respond
        for (const agent of session.agentClients.values()) {
          this.sendToClient(agent, response);
          break;
        }
      }
    }
  }

  /**
   * Handle tools/call request
   */
  private handleToolsCall(session: Session | undefined, request: JsonRpcRequest, senderClient?: SSEClient): void {
    if (!session || !session.browserClient) {
      // No browser connected, return error to sender
      const errorResponse = createErrorResponse(
        request.id,
        ErrorCodes.SESSION_ERROR,
        'No browser client connected to this session'
      );
      if (senderClient) {
        this.sendToClient(senderClient, errorResponse);
      } else {
        for (const agent of session?.agentClients.values() ?? []) {
          this.sendToClient(agent, errorResponse);
          break;
        }
      }
      return;
    }

    // Store mapping for response routing
    const internalId = generateMessageId();
    const agentId = senderClient?.id ?? '';

    session.pendingResponses.set(internalId, {
      agentId,
      originalId: request.id,
      timestamp: Date.now(),
    });

    // Forward to browser with internal ID
    const forwardedRequest: JsonRpcRequest = {
      ...request,
      id: internalId,
    };
    this.sendToClient(session.browserClient, forwardedRequest);

    // Set timeout for response
    setTimeout(() => {
      const pending = session.pendingResponses.get(internalId);
      if (pending) {
        session.pendingResponses.delete(internalId);
        const agent = session.agentClients.get(pending.agentId);
        if (agent) {
          this.sendToClient(agent, createErrorResponse(
            pending.originalId,
            ErrorCodes.TIMEOUT_ERROR,
            'Tool execution timeout'
          ));
        }
      }
    }, this.config.requestTimeout);
  }

  /**
   * Handle tool response from browser
   */
  private handleToolResponse(session: Session | undefined, response: JsonRpcResponse): void {
    if (!session) {
      return;
    }

    const pending = session.pendingResponses.get(String(response.id));
    if (!pending) {
      this.log(`No pending request found for response ${response.id}`);
      return;
    }

    session.pendingResponses.delete(String(response.id));

    // Find the agent and forward the response with original ID
    const agent = session.agentClients.get(pending.agentId);
    if (agent) {
      const forwardedResponse: JsonRpcResponse = {
        ...response,
        id: pending.originalId,
      };
      this.sendToClient(agent, forwardedResponse);
    }
  }

  /**
   * Handle session/join request
   */
  private handleSessionJoin(currentSessionId: string, request: JsonRpcRequest, clientId?: string): void {
    const { sessionId: targetSessionId } = request.params as { sessionId: string };
    const targetSession = this.sessions.get(targetSessionId);

    // Find the client that sent this request
    let client: SSEClient | undefined;
    if (clientId) {
      client = this.clients.get(clientId);
    } else {
      // Fallback: search for client by session ID
      for (const c of this.clients.values()) {
        if (c.sessionId === currentSessionId && c.type === 'agent') {
          client = c;
          break;
        }
      }
    }

    if (!client) {
      return;
    }

    if (!targetSession) {
      this.sendToClient(client, createErrorResponse(
        request.id,
        ErrorCodes.SESSION_ERROR,
        `Session not found: ${targetSessionId}`
      ));
      return;
    }

    // Add agent to target session (don't change client.sessionId - agent will post to target session)
    targetSession.agentClients.set(client.id, client);

    this.log(`Agent ${client.id} joined session ${targetSessionId}`);

    this.sendToClient(client, createResponse(request.id, {
      success: true,
      sessionId: targetSessionId,
      tools: targetSession.tools,
    }));
  }

  /**
   * Handle ping request
   */
  private handlePing(session: Session | undefined, request: JsonRpcRequest, senderClient?: SSEClient): void {
    const response = createPongResponse(request.id);

    // Respond to the sender
    if (senderClient) {
      this.sendToClient(senderClient, response);
    } else if (session?.browserClient) {
      this.sendToClient(session.browserClient, response);
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    this.log(`Client disconnected: ${clientId}`);

    // Clear keep-alive interval
    const interval = this.keepAliveIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.keepAliveIntervals.delete(clientId);
    }

    // Remove from session
    const session = this.sessions.get(client.sessionId);
    if (session) {
      if (session.browserClient?.id === clientId) {
        session.browserClient = null;
        // Notify agents that browser disconnected
        for (const agent of session.agentClients.values()) {
          this.sendToClient(agent, {
            jsonrpc: '2.0',
            method: 'browser/disconnected',
            params: { sessionId: session.id },
          } as JsonRpcMessage);
        }
      } else {
        session.agentClients.delete(clientId);
      }

      // Clean up empty sessions
      if (!session.browserClient && session.agentClients.size === 0) {
        this.sessions.delete(client.sessionId);
        this.log(`Session deleted: ${client.sessionId}`);
      }
    }

    this.clients.delete(clientId);
  }

  /**
   * Handle health check
   */
  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      sessions: this.sessions.size,
      clients: this.clients.size,
      uptime: process.uptime(),
    }));
  }

  /**
   * Handle sessions list request
   */
  private handleSessionsList(res: ServerResponse): void {
    const sessions = Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      hasBrowser: session.browserClient !== null,
      agentCount: session.agentClients.size,
      toolCount: session.tools.length,
      createdAt: session.createdAt.toISOString(),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions }));
  }

  /**
   * Send a message to a client via SSE
   */
  private sendToClient(client: SSEClient, message: JsonRpcMessage): void {
    if (!client.response.writableEnded) {
      const data = serializeMessage(message);
      client.response.write(`data: ${data}\n\n`);
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[BTCPServer] ${message}`, data ?? '');
    }
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new BTCPServer({ debug: true });
  server.start().then(() => {
    console.log('BTCP Server started. Press Ctrl+C to stop.');
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}

export default BTCPServer;
