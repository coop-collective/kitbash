const CODES = new Set(['invalid_request', 'forbidden', 'provider_failed', 'conflict', 'unavailable']);

export class BrokerError extends Error {
  constructor(code = 'provider_failed', status) {
    super(CODES.has(code) ? code : 'provider_failed');
    this.code = this.message;
    this.status = status;
  }
}

export const fail = code => { throw new BrokerError(code); };
export const publicError = error => ({ error: { code: error instanceof BrokerError ? error.code : 'provider_failed' } });
