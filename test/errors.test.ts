import { describe, it, expect } from 'vitest';
import { MCPError, AuthError, ProviderError } from '../src/errors';

describe('MCPError', () => {
  it('stores statusCode, errorCode, and message', () => {
    const err = new MCPError(422, 'validation_error', 'Bad input');
    expect(err.statusCode).toBe(422);
    expect(err.errorCode).toBe('validation_error');
    expect(err.message).toBe('Bad input');
    expect(err.name).toBe('MCPError');
  });

  it('serializes to JSON with error and error_description', () => {
    const err = new MCPError(400, 'invalid_request', 'Missing param');
    expect(err.toJSON()).toEqual({
      error: 'invalid_request',
      error_description: 'Missing param',
    });
  });

  it('is an instance of Error', () => {
    const err = new MCPError(500, 'server_error', 'Boom');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('AuthError', () => {
  it('defaults to status 400', () => {
    const err = new AuthError('invalid_grant', 'Bad code');
    expect(err.statusCode).toBe(400);
    expect(err.errorCode).toBe('invalid_grant');
    expect(err.name).toBe('AuthError');
  });

  it('accepts a custom status code', () => {
    const err = new AuthError('unauthorized', 'No token', 401);
    expect(err.statusCode).toBe(401);
  });

  it('is an instance of MCPError', () => {
    expect(new AuthError('x', 'y')).toBeInstanceOf(MCPError);
  });
});

describe('ProviderError', () => {
  it('uses status 502 and provider_error code', () => {
    const err = new ProviderError('Google API timeout');
    expect(err.statusCode).toBe(502);
    expect(err.errorCode).toBe('provider_error');
    expect(err.message).toBe('Google API timeout');
    expect(err.name).toBe('ProviderError');
  });

  it('serializes correctly', () => {
    const err = new ProviderError('Failed');
    expect(err.toJSON()).toEqual({
      error: 'provider_error',
      error_description: 'Failed',
    });
  });

  it('is an instance of MCPError', () => {
    expect(new ProviderError('x')).toBeInstanceOf(MCPError);
  });
});
