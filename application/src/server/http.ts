import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { logger } from './logger';
import { getRuntime, HttpError, type AresRuntime } from './runtime';

const log = logger('api');

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** When JUDGE_ACCESS_CODE is set, mutating routes need it in `x-judge-code` (compared in constant time). */
export function assertJudge(req: Request, rt: AresRuntime): void {
  const code = rt.env.JUDGE_ACCESS_CODE;
  if (!code) return;
  const given = req.headers.get('x-judge-code') ?? '';
  if (!timingSafeEqual(digest(given), digest(code))) {
    throw new HttpError(401, 'Mission Control access code required (send it in the x-judge-code header).');
  }
}

/** Parses an optional JSON body (empty → {}) and validates it; problems become 400 { error }. */
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  if (text.length > 200_000) throw new HttpError(413, 'Request body too large.');
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'The request body must be valid JSON.');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `Invalid request: ${issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'bad shape'}`);
  }
  return parsed.data;
}

/**
 * Every API handler runs through here: boot the runtime once, check the judge code on mutating routes,
 * and map HttpError → `{ error }` with its status. Unexpected errors are logged, never leaked.
 */
export function route<Ctx = unknown>(handler: (req: Request, rt: AresRuntime, ctx: Ctx) => Promise<Response>, opts: { judge?: boolean } = {}) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      const rt = getRuntime();
      await rt.ready();
      if (opts.judge) assertJudge(req, rt);
      return await handler(req, rt, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      log.error(`${req.method} ${new URL(req.url).pathname} failed`, err);
      return json({ error: 'Internal server error. Check the server log.' }, 500);
    }
  };
}
