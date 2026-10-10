import { buildEvidence } from '@/server/export';
import { route, SESSION_ID } from '@/server/http';
import { HttpError } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Evidence pack (.zip): final allocation, transcripts, per-phase logs, crisis log, compliance, manifest with DB parity. */
export const GET = route(async (req, rt) => {
  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (sessionId && !SESSION_ID.test(sessionId)) throw new HttpError(400, 'sessionId must be a session UUID.');
  const file = await buildEvidence(rt, sessionId);
  return new Response(file.body as unknown as BodyInit, {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' },
  });
});
