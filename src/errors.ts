export class MCPError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'MCPError';
  }

  toJSON() {
    return { error: this.errorCode, error_description: this.message };
  }
}

export class AuthError extends MCPError {
  constructor(errorCode: string, message: string, statusCode = 400) {
    super(statusCode, errorCode, message);
    this.name = 'AuthError';
  }
}

export class ProviderError extends MCPError {
  constructor(message: string) {
    super(502, 'provider_error', message);
    this.name = 'ProviderError';
  }
}
