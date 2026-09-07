

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppError, errorHandler } from './error';
import type { Request, Response, NextFunction } from 'express';


function fakeResponse() {
  const state = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  };
  return { res: res as unknown as Response, state };
}

const run = (err: Error) => {
  const { res, state } = fakeResponse();
  errorHandler(err, {} as Request, res, (() => {}) as NextFunction);
  return state;
};


const parseFailed = Object.assign(new Error('Unexpected token n in JSON at position 1'), {
  status: 400, statusCode: 400, type: 'entity.parse.failed', expose: true,
});
const tooLarge = Object.assign(new Error('request entity too large'), {
  status: 413, statusCode: 413, type: 'entity.too.large', limit: 102400,
});

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { consoleError.mockRestore(); });

describe('AppError — our own errors', () => {
  it('uses the status it carries and sends its message verbatim', () => {
    const s = run(new AppError('Phase 2 must be approved first', 409));
    expect(s.status).toBe(409);
    expect(s.body).toEqual({ error: 'Phase 2 must be approved first' });
  });

  it('defaults to 400', () => {
    expect(run(new AppError('bad input')).status).toBe(400);
  });
});

describe('foreign errors that know their own status (DEF-01)', () => {
  it('maps malformed JSON to 400, not 500', () => {
    const s = run(parseFailed);
    expect(s.status).toBe(400);
  });

  it('maps an oversized body to 413, not 500', () => {
    const s = run(tooLarge);
    expect(s.status).toBe(413);
  });

  it('does not forward a library error message to the client', () => {

    const s = run(parseFailed);
    expect(s.body).toEqual({ error: 'The request body could not be read.' });
    expect(JSON.stringify(s.body)).not.toMatch(/Unexpected token/);
  });

  it('does not log a client error as a server fault', () => {
    run(parseFailed);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reads statusCode when status is absent', () => {
    expect(run(Object.assign(new Error('x'), { statusCode: 415 })).status).toBe(415);
  });
});

describe('anything else is a 500', () => {
  it('maps an ordinary throw to 500 and hides the message', () => {
    const s = run(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    expect(s.status).toBe(500);
    expect(s.body).toEqual({ error: 'Internal error' });
    expect(JSON.stringify(s.body)).not.toMatch(/ECONNREFUSED|5432/);
  });

  it('logs the real error server-side', () => {
    run(new Error('boom'));
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('does NOT trust a foreign 5xx', () => {

    const s = run(Object.assign(new Error('upstream exploded'), { status: 503 }));
    expect(s.status).toBe(500);
    expect(s.body).toEqual({ error: 'Internal error' });
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('ignores a nonsensical status', () => {
    for (const bad of [0, -1, 200, 999, '400', null, undefined, NaN]) {
      expect(run(Object.assign(new Error('x'), { status: bad })).status).toBe(500);
    }
  });
});
