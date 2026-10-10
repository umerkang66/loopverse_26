import { json, route, SESSION_ID } from '@/server/http';
import { toPublicState } from '@/server/public-state';
import { HttpError } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One archived (or the current) session in the /api/state shape, loaded with the same code as boot. */
export const GET = route<RouteContext<'/api/sessions/[id]'>>(async (_req, rt, ctx) => {
  const { id } = await ctx.params;
  if (!SESSION_ID.test(id)) throw new HttpError(400, 'Session ids are UUIDs.');
  let s;
  try {
    s = await rt.getSession(id);
  } catch {
    throw new HttpError(503, 'The session could not be read from storage. Try again in a moment.');
  }
  if (!s) throw new HttpError(404, 'Session not found for this instance.');
  const isCurrent = id === rt.getSnapshot().id;
  const storage = isCurrent ? rt.persistence.status() : { ...rt.persistence.status(), pendingRows: 0, dbMessageCount: s.messages.length, state: 'SYNCED' as const };
  return json({ state: toPublicState(s, storage), messages: s.messages, archived: !isCurrent });
});
