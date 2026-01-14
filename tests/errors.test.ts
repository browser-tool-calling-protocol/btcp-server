/**
 * Tests for error classes
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCodes,
  BTCPError,
  BTCPConnectionError,
  BTCPTimeoutError,
  BTCPSessionError,
  BTCPValidationError,
  BTCPExecutionError,
  BTCPToolNotFoundError,
  BTCPPermissionError,
  BTCPParseError,
  BTCPInvalidRequestError,
  BTCPMethodNotFoundError,
} from '../src/errors.js';

describe('Error Classes', () => {
  describe('ErrorCodes', () => {
    it('should have standard JSON-RPC error codes', () => {
      expect(ErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(ErrorCodes.INVALID_REQUEST).toBe(-32600);
      expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(ErrorCodes.INVALID_PARAMS).toBe(-32602);
      expect(ErrorCodes.INTERNAL_ERROR).toBe(-32603);
    });

    it('should have BTCP-specific error codes', () => {
      expect(ErrorCodes.CONNECTION_ERROR).toBe(-32000);
      expect(ErrorCodes.TIMEOUT_ERROR).toBe(-32001);
      expect(ErrorCodes.SESSION_ERROR).toBe(-32002);
      expect(ErrorCodes.EXECUTION_ERROR).toBe(-32003);
      expect(ErrorCodes.TOOL_NOT_FOUND).toBe(-32004);
      expect(ErrorCodes.VALIDATION_ERROR).toBe(-32005);
      expect(ErrorCodes.PERMISSION_ERROR).toBe(-32006);
    });
  });

  describe('BTCPError', () => {
    it('should create a basic error', () => {
      const error = new BTCPError('Something went wrong');

      expect(error.message).toBe('Something went wrong');
      expect(error.name).toBe('BTCPError');
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.data).toBeUndefined();
    });

    it('should accept custom code and data', () => {
      const error = new BTCPError('Custom error', -32000, { detail: 'extra info' });

      expect(error.code).toBe(-32000);
      expect(error.data).toEqual({ detail: 'extra info' });
    });

    it('should serialize to JSON', () => {
      const error = new BTCPError('Error', -32600, { field: 'name' });
      const json = error.toJSON();

      expect(json).toEqual({
        code: -32600,
        message: 'Error',
        data: { field: 'name' },
      });
    });

    it('should omit data from JSON if undefined', () => {
      const error = new BTCPError('Error');
      const json = error.toJSON();

      expect(json).toEqual({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Error',
      });
      expect('data' in json).toBe(false);
    });

    it('should be an instance of Error', () => {
      const error = new BTCPError('Error');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BTCPError);
    });
  });

  describe('BTCPConnectionError', () => {
    it('should create a connection error', () => {
      const error = new BTCPConnectionError('Connection failed');

      expect(error.message).toBe('Connection failed');
      expect(error.name).toBe('BTCPConnectionError');
      expect(error.code).toBe(ErrorCodes.CONNECTION_ERROR);
    });

    it('should be an instance of BTCPError', () => {
      const error = new BTCPConnectionError('Error');

      expect(error).toBeInstanceOf(BTCPError);
      expect(error).toBeInstanceOf(BTCPConnectionError);
    });
  });

  describe('BTCPTimeoutError', () => {
    it('should create a timeout error with default message', () => {
      const error = new BTCPTimeoutError();

      expect(error.message).toBe('Request timed out');
      expect(error.name).toBe('BTCPTimeoutError');
      expect(error.code).toBe(ErrorCodes.TIMEOUT_ERROR);
    });

    it('should accept custom message', () => {
      const error = new BTCPTimeoutError('Operation timed out after 30s');

      expect(error.message).toBe('Operation timed out after 30s');
    });
  });

  describe('BTCPSessionError', () => {
    it('should create a session error', () => {
      const error = new BTCPSessionError('Session not found');

      expect(error.message).toBe('Session not found');
      expect(error.name).toBe('BTCPSessionError');
      expect(error.code).toBe(ErrorCodes.SESSION_ERROR);
    });
  });

  describe('BTCPValidationError', () => {
    it('should create a validation error', () => {
      const error = new BTCPValidationError('Invalid parameter: name');

      expect(error.message).toBe('Invalid parameter: name');
      expect(error.name).toBe('BTCPValidationError');
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should include validation details in data', () => {
      const error = new BTCPValidationError('Validation failed', {
        fields: ['email', 'password'],
      });

      expect(error.data).toEqual({ fields: ['email', 'password'] });
    });
  });

  describe('BTCPExecutionError', () => {
    it('should create an execution error', () => {
      const error = new BTCPExecutionError('Tool execution failed');

      expect(error.message).toBe('Tool execution failed');
      expect(error.name).toBe('BTCPExecutionError');
      expect(error.code).toBe(ErrorCodes.EXECUTION_ERROR);
      expect(error.toolName).toBeUndefined();
    });

    it('should include tool name', () => {
      const error = new BTCPExecutionError('Failed to click element', 'browser_click');

      expect(error.toolName).toBe('browser_click');
    });

    it('should include additional data', () => {
      const error = new BTCPExecutionError('Error', 'tool', { selector: '#btn' });

      expect(error.data).toEqual({ selector: '#btn' });
    });
  });

  describe('BTCPToolNotFoundError', () => {
    it('should create a tool not found error', () => {
      const error = new BTCPToolNotFoundError('unknown_tool');

      expect(error.message).toBe('Tool not found: unknown_tool');
      expect(error.name).toBe('BTCPToolNotFoundError');
      expect(error.code).toBe(ErrorCodes.TOOL_NOT_FOUND);
      expect(error.toolName).toBe('unknown_tool');
    });

    it('should include tool name in data', () => {
      const error = new BTCPToolNotFoundError('my_tool');

      expect(error.data).toEqual({ toolName: 'my_tool' });
    });
  });

  describe('BTCPPermissionError', () => {
    it('should create a permission error', () => {
      const error = new BTCPPermissionError('Access denied');

      expect(error.message).toBe('Access denied');
      expect(error.name).toBe('BTCPPermissionError');
      expect(error.code).toBe(ErrorCodes.PERMISSION_ERROR);
    });
  });

  describe('BTCPParseError', () => {
    it('should create a parse error with default message', () => {
      const error = new BTCPParseError();

      expect(error.message).toBe('Parse error');
      expect(error.name).toBe('BTCPParseError');
      expect(error.code).toBe(ErrorCodes.PARSE_ERROR);
    });

    it('should accept custom message', () => {
      const error = new BTCPParseError('Invalid JSON syntax');

      expect(error.message).toBe('Invalid JSON syntax');
    });
  });

  describe('BTCPInvalidRequestError', () => {
    it('should create an invalid request error with default message', () => {
      const error = new BTCPInvalidRequestError();

      expect(error.message).toBe('Invalid request');
      expect(error.name).toBe('BTCPInvalidRequestError');
      expect(error.code).toBe(ErrorCodes.INVALID_REQUEST);
    });
  });

  describe('BTCPMethodNotFoundError', () => {
    it('should create a method not found error', () => {
      const error = new BTCPMethodNotFoundError('unknown/method');

      expect(error.message).toBe('Method not found: unknown/method');
      expect(error.name).toBe('BTCPMethodNotFoundError');
      expect(error.code).toBe(ErrorCodes.METHOD_NOT_FOUND);
      expect(error.method).toBe('unknown/method');
    });

    it('should include method in data', () => {
      const error = new BTCPMethodNotFoundError('test');

      expect(error.data).toEqual({ method: 'test' });
    });
  });

  describe('Error Inheritance', () => {
    it('all errors should be catchable as BTCPError', () => {
      const errors = [
        new BTCPConnectionError('test'),
        new BTCPTimeoutError('test'),
        new BTCPSessionError('test'),
        new BTCPValidationError('test'),
        new BTCPExecutionError('test'),
        new BTCPToolNotFoundError('test'),
        new BTCPPermissionError('test'),
        new BTCPParseError('test'),
        new BTCPInvalidRequestError('test'),
        new BTCPMethodNotFoundError('test'),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(BTCPError);
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('errors should have proper prototype chain', () => {
      const error = new BTCPConnectionError('test');

      // Can use try/catch properly
      let caught = false;
      try {
        throw error;
      } catch (e) {
        if (e instanceof BTCPConnectionError) {
          caught = true;
        }
      }

      expect(caught).toBe(true);
    });
  });
});
