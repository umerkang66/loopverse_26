import { z } from 'zod';
import { json, readBody, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  resources: z.unknown().optional(),
  maxRounds: z.number().int().min(1).max(12).optional(),
  deadlineSeconds: z.number().int().min(30).max(1800).optional(),
});

export const POST = route(
  async (req, rt) => {
    const body = await readBody(req, Body);
    return json(await rt.start(body), 202);
  },
  { judge: true },
);
