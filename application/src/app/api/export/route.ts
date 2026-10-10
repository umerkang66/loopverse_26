import { buildExport, type ExportFormat } from '@/server/export';
import { route, SESSION_ID } from '@/server/http';
import { HttpError } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATS: ExportFormat[] = ['json', 'csv', 'final'];

/** ?format=json · ?format=csv&kind=transcript|plans|votes|commitments · ?format=final[&scenario=S1] · optional &sessionId=<uuid> */
export const GET = route(async (req, rt) => {
  const q = new URL(req.url).searchParams;
  const format = (q.get('format') ?? 'json') as ExportFormat;
  if (!FORMATS.includes(format)) throw new HttpError(400, `format must be one of ${FORMATS.join(', ')}`);
  const sessionId = q.get('sessionId');
  if (sessionId && !SESSION_ID.test(sessionId)) throw new HttpError(400, 'sessionId must be a session UUID.');
  const scenarioId = q.get('scenario');
  if (scenarioId && !/^S\d{1,3}$/.test(scenarioId)) throw new HttpError(400, 'scenario must look like S0, S1, …');
  const file = await buildExport(rt, { format, kind: q.get('kind'), sessionId, scenarioId });
  const disposition = q.get('inline') === '1' ? 'inline' : 'attachment';
  return new Response(file.body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `${disposition}; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
