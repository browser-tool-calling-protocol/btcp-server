/**
 * BTCP Errors - Custom error classes for the Browser Tool Calling Protocol
 */

/**
 * JSON-RPC 2.0 Error Codes
 */
export const ErrorCodes = {
  // Standard JSON-RPC errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // BTCP-specific errors (-32000 to -32099)
  CONNECTION_ERROR: -32000,
  TIMEOUT_ERROR: -32001,
  SESSION_ERROR: -32002,
  EXECUTION_ERROR: -32003,
  TOOL_NOT_FOUND: -32004,
  VALIDATION_ERROR: -32005,
  PERMISSION_ERROR: -32006,
} as const;

/**
 * Base BTCP Error class
 */
export class BTCPError extends Error {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(message: string, code: number = ErrorCodes.INTERNAL_ERROR, data?: unknown) {
    super(message);
    this.name = 'BTCPError';
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, BTCPError.prototype);
  }

  toJSON(): { code: number; message: string; data?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined && { data: this.data }),
    };
  }
}

/**
 * Connection-related errors
 */
export class BTCPConnectionError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, ErrorCodes.CONNECTION_ERROR, data);
    this.name = 'BTCPConnectionError';
    Object.setPrototypeOf(this, BTCPConnectionError.prototype);
  }
}

/**
 * Timeout errors
 */
export class BTCPTimeoutError extends BTCPError {
  constructor(message: string = 'Request timed out', data?: unknown) {
    super(message, ErrorCodes.TIMEOUT_ERROR, data);
    this.name = 'BTCPTimeoutError';
    Object.setPrototypeOf(this, BTCPTimeoutError.prototype);
  }
}

/**
 * Session-related errors
 */
export class BTCPSessionError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, ErrorCodes.SESSION_ERROR, data);
    this.name = 'BTCPSessionError';
    Object.setPrototypeOf(this, BTCPSessionError.prototype);
  }
}

/**
 * Validation errors for invalid parameters
 */
export class BTCPValidationError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, ErrorCodes.VALIDATION_ERROR, data);
    this.name = 'BTCPValidationError';
    Object.setPrototypeOf(this, BTCPValidationError.prototype);
  }
}

/**
 * Tool execution errors
 */
export class BTCPExecutionError extends BTCPError {
  public readonly toolName?: string;

  constructor(message: string, toolName?: string, data?: unknown) {
    super(message, ErrorCodes.EXECUTION_ERROR, data);
    this.name = 'BTCPExecutionError';
    this.toolName = toolName;
    Object.setPrototypeOf(this, BTCPExecutionError.prototype);
  }
}

/**
 * Tool not found errors
 */
export class BTCPToolNotFoundError extends BTCPError {
  public readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, ErrorCodes.TOOL_NOT_FOUND, { toolName });
    this.name = 'BTCPToolNotFoundError';
    this.toolName = toolName;
    Object.setPrototypeOf(this, BTCPToolNotFoundError.prototype);
  }
}

/**
 * Permission errors
 */
export class BTCPPermissionError extends BTCPError {
  constructor(message: string, data?: unknown) {
    super(message, ErrorCodes.PERMISSION_ERROR, data);
    this.name = 'BTCPPermissionError';
    Object.setPrototypeOf(this, BTCPPermissionError.prototype);
  }
}

/**
 * Parse errors for malformed JSON-RPC messages
 */
export class BTCPParseError extends BTCPError {
  constructor(message: string = 'Parse error', data?: unknown) {
    super(message, ErrorCodes.PARSE_ERROR, data);
    this.name = 'BTCPParseError';
    Object.setPrototypeOf(this, BTCPParseError.prototype);
  }
}

/**
 * Invalid request errors
 */
export class BTCPInvalidRequestError extends BTCPError {
  constructor(message: string = 'Invalid request', data?: unknown) {
    super(message, ErrorCodes.INVALID_REQUEST, data);
    this.name = 'BTCPInvalidRequestError';
    Object.setPrototypeOf(this, BTCPInvalidRequestError.prototype);
  }
}

/**
 * Method not found errors
 */
export class BTCPMethodNotFoundError extends BTCPError {
  public readonly method: string;

  constructor(method: string) {
    super(`Method not found: ${method}`, ErrorCodes.METHOD_NOT_FOUND, { method });
    this.name = 'BTCPMethodNotFoundError';
    this.method = method;
    Object.setPrototypeOf(this, BTCPMethodNotFoundError.prototype);
  }
}
