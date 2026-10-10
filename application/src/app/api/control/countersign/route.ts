import { z } from 'zod';
import { json, readBody, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  decision: z.enum(['COUNTERSIGN', 'VETO']),
  reason: z.string().max(1000).optional(),
});

export const POST = route(
  async (req, rt) => {
    const body = await readBody(req, Body);
    return json(await rt.countersign(body.decision, body.reason ?? ''));
  },
  { judge: true },
);
