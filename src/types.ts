/**
 * BTCP Types - Browser Tool Calling Protocol Type Definitions
 */

// =============================================================================
// JSON-RPC 2.0 Base Types
// =============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// =============================================================================
// JSON Schema Types
// =============================================================================

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
}

// =============================================================================
// BTCP Tool Types
// =============================================================================

export interface BTCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  capabilities?: string[];
  timeout?: number;
  examples?: BTCPToolExample[];
  metadata?: Record<string, unknown>;
}

export interface BTCPToolExample {
  name?: string;
  description?: string;
  input: Record<string, unknown>;
  output: unknown;
}

// =============================================================================
// BTCP Content Types
// =============================================================================

export interface BTCPTextContent {
  type: 'text';
  text: string;
}

export interface BTCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface BTCPResourceContent {
  type: 'resource';
  uri: string;
  text?: string;
  mimeType?: string;
  blob?: string;
}

export type BTCPContent = BTCPTextContent | BTCPImageContent | BTCPResourceContent;

// =============================================================================
// BTCP Message Types
// =============================================================================

export type BTCPMessageType =
  | 'hello'
  | 'tools/list'
  | 'tools/call'
  | 'tools/register'
  | 'session/join'
  | 'session/leave'
  | 'capabilities/request'
  | 'capabilities/grant'
  | 'ping'
  | 'pong';

export interface BTCPHelloMessage {
  jsonrpc: '2.0';
  method: 'hello';
  params: {
    clientType: 'browser' | 'agent';
    clientId?: string;
    capabilities?: string[];
    version?: string;
  };
}

export interface BTCPToolsListRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/list';
  params?: {
    filter?: {
      capabilities?: string[];
      names?: string[];
    };
  };
}

export interface BTCPToolsListResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: {
    tools: BTCPToolDefinition[];
  };
}

export interface BTCPToolCallRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/call';
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

export interface BTCPToolCallResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: {
    content: BTCPContent[];
    isError?: boolean;
  };
  error?: JsonRpcError;
}

export interface BTCPToolRegisterRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/register';
  params: {
    tools: BTCPToolDefinition[];
  };
}

export interface BTCPSessionJoinRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'session/join';
  params: {
    sessionId: string;
  };
}

export interface BTCPSessionJoinResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: {
    success: boolean;
    sessionId: string;
    tools?: BTCPToolDefinition[];
  };
}

export interface BTCPPingMessage {
  jsonrpc: '2.0';
  id: string | number;
  method: 'ping';
}

export interface BTCPPongMessage {
  jsonrpc: '2.0';
  id: string | number;
  result: {
    pong: true;
    timestamp: number;
  };
}

// =============================================================================
// BTCP Client Configuration
// =============================================================================

export interface BTCPClientConfig {
  serverUrl: string;
  sessionId?: string;
  debug?: boolean;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  connectionTimeout?: number;
}

export interface BTCPClientEvents {
  connect: () => void;
  disconnect: (code?: number, reason?: string) => void;
  error: (error: Error) => void;
  message: (message: JsonRpcMessage) => void;
  toolCall: (request: BTCPToolCallRequest) => void;
  toolsList: (tools: BTCPToolDefinition[]) => void;
}

export type BTCPClientEventName = keyof BTCPClientEvents;
export type BTCPClientEventHandler<T extends BTCPClientEventName> = BTCPClientEvents[T];

// =============================================================================
// Tool Executor Types
// =============================================================================

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<BTCPContent[] | BTCPContent | string | Record<string, unknown> | unknown>;

export interface ToolExecutorConfig {
  handlers?: Record<string, ToolHandler>;
  browserAgent?: BrowserAgent;
  debug?: boolean;
}

// =============================================================================
// Browser Agent Interface
// =============================================================================

export interface BrowserAgent {
  snapshot(): Promise<string>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  type(text: string): Promise<void>;
  hover(selector: string): Promise<void>;
  press(key: string): Promise<void>;
  scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>;
  getText(selector: string): Promise<string>;
  getAttribute(selector: string, attribute: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  screenshot(): Promise<string>;
  wait(timeout: number): Promise<void>;
  evaluate(script: string): Promise<unknown>;
}

// =============================================================================
// Server Types
// =============================================================================

export interface SSEClient {
  id: string;
  type: 'browser' | 'agent';
  response: ServerResponse;
  sessionId: string;
}

export interface Session {
  id: string;
  browserClient: SSEClient | null;
  agentClients: Map<string, SSEClient>;
  tools: BTCPToolDefinition[];
  pendingResponses: Map<string, PendingResponse>;
  createdAt: Date;
}

export interface PendingResponse {
  agentId: string;
  originalId: string | number;
  timestamp: number;
}

export interface BTCPServerConfig {
  port?: number;
  host?: string;
  debug?: boolean;
  keepAliveInterval?: number;
  requestTimeout?: number;
}

// Node.js HTTP types (for server)
import type { ServerResponse } from 'http';
