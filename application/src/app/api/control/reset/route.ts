import { z } from 'zod';
import { json, readBody, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  hard: z.boolean().optional(),
  confirm: z.string().max(20).optional(),
});

export const POST = route(
  async (req, rt) => {
    const body = await readBody(req, Body);
    return json(await rt.reset(body));
  },
  { judge: true },
);
