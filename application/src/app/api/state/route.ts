import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Full public state plus the transcript (`?sinceSeq=N` returns only newer messages). */
export const GET = route(async (req, rt) => {
  const sinceSeq = Number(new URL(req.url).searchParams.get('sinceSeq') ?? 0);
  return json({ state: rt.getPublicState(), messages: rt.getMessages(Number.isFinite(sinceSeq) ? sinceSeq : 0) });
});
