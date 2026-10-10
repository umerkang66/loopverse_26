import { json, route } from '@/server/http';
import { HttpError } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Past and current sessions of this instance: Supabase `ares_sessions`, or the local index in file mode. */
export const GET = route(async (_req, rt) => {
  try {
    return json({ currentSessionId: rt.getSnapshot().id, storage: rt.persistence.driver, sessions: await rt.listSessions() });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, 'The session archive could not be read from storage. Try again in a moment.');
  }
});
