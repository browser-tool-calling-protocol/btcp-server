/**
 * BTCP Client - HTTP Streaming client for Browser Tool Calling Protocol
 *
 * This client connects to a BTCP server using:
 * - SSE (Server-Sent Events) for receiving messages
 * - HTTP POST for sending messages
 */

import type {
  BTCPClientConfig,
  BTCPClientEventName,
  BTCPClientEventHandler,
  BTCPToolDefinition,
  BTCPToolCallRequest,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcMessage,
  BrowserAgent,
} from './types.js';
import { ToolExecutor } from './executor.js';
import {
  createResponse,
  createErrorResponse,
  createToolCallResponse,
  createToolCallErrorResponse,
  createPongResponse,
  parseMessage,
  serializeMessage,
  isRequest,
  isResponse,
  generateMessageId,
} from './protocol.js';
import { BTCPConnectionError, BTCPTimeoutError, ErrorCodes } from './errors.js';

// EventSource polyfill for Node.js
let EventSourceImpl: typeof EventSource;
if (typeof EventSource !== 'undefined') {
  EventSourceImpl = EventSource;
} else {
  // Dynamic import for Node.js environments
  EventSourceImpl = class MockEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    url: string;
    withCredentials = false;

    constructor(url: string) {
      this.url = url;
      this.initNodeEventSource();
    }

    private async initNodeEventSource() {
      try {
        // Use Node.js http/https modules
        const urlObj = new URL(this.url);
        const http = await import(urlObj.protocol === 'https:' ? 'https' : 'http');

        const req = http.request(this.url, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        }, (res) => {
          if (res.statusCode !== 200) {
            this.readyState = 2;
            if (this.onerror) {
              this.onerror(new Event('error'));
            }
            return;
          }

          this.readyState = 1;
          if (this.onopen) {
            this.onopen(new Event('open'));
          }

          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data && this.onmessage) {
                  this.onmessage(new MessageEvent('message', { data }));
                }
              }
            }
          });

          res.on('end', () => {
            this.readyState = 2;
            if (this.onerror) {
              this.onerror(new Event('error'));
            }
          });
        });

        req.on('error', () => {
          this.readyState = 2;
          if (this.onerror) {
            this.onerror(new Event('error'));
          }
        });

        req.end();
      } catch {
        this.readyState = 2;
        if (this.onerror) {
          this.onerror(new Event('error'));
        }
      }
    }

    close() {
      this.readyState = 2;
    }

    addEventListener() {}
    removeEventListener() {}
    dispatchEvent(): boolean { return false; }
  } as unknown as typeof EventSource;
}

interface PendingRequest {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * BTCP Client class - connects to BTCP server and handles tool execution
 */
export class BTCPClient {
  private config: Required<BTCPClientConfig>;
  private eventSource: EventSource | null = null;
  private sessionId: string;
  private executor: ToolExecutor;
  private connected = false;
  private reconnectAttempts = 0;
  private eventHandlers: Map<BTCPClientEventName, Set<BTCPClientEventHandler<BTCPClientEventName>>> = new Map();
  private pendingRequests: Map<string | number, PendingRequest> = new Map();

  constructor(config: BTCPClientConfig) {
    this.config = {
      serverUrl: config.serverUrl || 'http://localhost:8765',
      sessionId: config.sessionId || generateMessageId(),
      debug: config.debug ?? false,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      connectionTimeout: config.connectionTimeout ?? 30000,
    };
    this.sessionId = this.config.sessionId;
    this.executor = new ToolExecutor({ debug: this.config.debug });
  }

  /**
   * Connect to the BTCP server via SSE
   */
  async connect(): Promise<void> {
    if (this.connected) {
      this.log('Already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      const url = `${this.config.serverUrl}/events?sessionId=${this.sessionId}&clientType=browser&version=1.0`;
      this.log(`Connecting to ${url}`);

      const connectionTimeout = setTimeout(() => {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        this.eventSource = new EventSourceImpl(url);

        this.eventSource.onopen = () => {
          clearTimeout(connectionTimeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.log('Connected to server');
          this.emit('connect');
          resolve();
        };

        this.eventSource.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.eventSource.onerror = () => {
          clearTimeout(connectionTimeout);
          const wasConnected = this.connected;
          this.connected = false;

          if (wasConnected) {
            this.log('Connection lost');
            this.emit('disconnect', 1006, 'Connection lost');
            this.handleReconnect();
          } else {
            reject(new BTCPConnectionError('Failed to connect to server'));
          }
        };
      } catch (error) {
        clearTimeout(connectionTimeout);
        reject(new BTCPConnectionError(
          error instanceof Error ? error.message : 'Failed to create EventSource'
        ));
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
    this.reconnectAttempts = this.config.maxReconnectAttempts; // Prevent auto-reconnect
    this.emit('disconnect', 1000, 'Client disconnected');
    this.log('Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the tool executor instance
   */
  getExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * Set the browser agent for automation tools
   */
  setBrowserAgent(agent: BrowserAgent): void {
    this.executor.setBrowserAgent(agent);
  }

  /**
   * Register tools with the server
   */
  async registerTools(tools?: BTCPToolDefinition[]): Promise<void> {
    const toolDefs = tools ?? this.executor.getToolDefinitions();
    this.log(`Registering ${toolDefs.length} tools`);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: generateMessageId(),
      method: 'tools/register',
      params: { tools: toolDefs },
    };

    await this.sendMessage(request);
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = generateMessageId();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params && { params }),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new BTCPTimeoutError(`Request timeout: ${method}`));
      }, this.config.connectionTimeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        },
        reject,
        timeout,
      });

      this.sendMessage(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  /**
   * Subscribe to an event
   */
  on<T extends BTCPClientEventName>(event: T, handler: BTCPClientEventHandler<T>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as BTCPClientEventHandler<BTCPClientEventName>);
  }

  /**
   * Unsubscribe from an event
   */
  off<T extends BTCPClientEventName>(event: T, handler: BTCPClientEventHandler<T>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as BTCPClientEventHandler<BTCPClientEventName>);
    }
  }

  /**
   * Handle incoming message from SSE
   */
  private handleMessage(data: string): void {
    try {
      const message = parseMessage(data);
      this.log('Received message', message);
      this.emit('message', message);

      if (isRequest(message)) {
        this.handleRequest(message);
      } else if (isResponse(message)) {
        this.handleResponse(message);
      }
    } catch (error) {
      this.log('Failed to parse message', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle incoming JSON-RPC request
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;
    this.log(`Handling request: ${method}`);

    try {
      let response: JsonRpcResponse;

      switch (method) {
        case 'tools/list':
          response = createResponse(id, {
            tools: this.executor.getToolDefinitions(),
          });
          break;

        case 'tools/call':
          response = await this.handleToolCall(request as BTCPToolCallRequest);
          break;

        case 'ping':
          response = createPongResponse(id);
          break;

        default:
          response = createErrorResponse(
            id,
            ErrorCodes.METHOD_NOT_FOUND,
            `Method not found: ${method}`
          );
      }

      await this.sendMessage(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const response = createErrorResponse(id, ErrorCodes.INTERNAL_ERROR, errorMessage);
      await this.sendMessage(response);
    }
  }

  /**
   * Handle tool call request
   */
  private async handleToolCall(request: BTCPToolCallRequest): Promise<JsonRpcResponse> {
    const { id, params } = request;
    const { name, arguments: args = {} } = params;

    this.emit('toolCall', request);

    try {
      const content = await this.executor.execute(name, args);
      return createToolCallResponse(id, content);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return createToolCallErrorResponse(id, errorMessage);
    }
  }

  /**
   * Handle incoming JSON-RPC response
   */
  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  /**
   * Send a message to the server via HTTP POST
   */
  private async sendMessage(message: JsonRpcMessage): Promise<void> {
    const url = `${this.config.serverUrl}/message?sessionId=${this.sessionId}`;
    const body = serializeMessage(message);

    this.log('Sending message', message);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });

      if (!response.ok) {
        throw new BTCPConnectionError(`HTTP error: ${response.status}`);
      }
    } catch (error) {
      if (error instanceof BTCPConnectionError) {
        throw error;
      }
      throw new BTCPConnectionError(
        error instanceof Error ? error.message : 'Failed to send message'
      );
    }
  }

  /**
   * Handle automatic reconnection
   */
  private handleReconnect(): void {
    if (!this.config.autoReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log('Max reconnection attempts reached');
      this.emit('error', new BTCPConnectionError('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        this.log('Reconnection failed', error);
        this.handleReconnect();
      });
    }, delay);
  }

  /**
   * Emit an event to all registered handlers
   */
  private emit<T extends BTCPClientEventName>(
    event: T,
    ...args: Parameters<BTCPClientEventHandler<T>>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...args: unknown[]) => void)(...args);
        } catch (error) {
          this.log(`Error in event handler for ${event}`, error);
        }
      }
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[BTCPClient:${this.sessionId.slice(-6)}] ${message}`, data ?? '');
    }
  }
}

export default BTCPClient;
