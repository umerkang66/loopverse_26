import { z } from 'zod';
import { json, readBody, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ hitlEnabled: z.boolean() });

/** Runtime switches that are safe to change mid-session. */
export const POST = route(
  async (req, rt) => {
    const body = await readBody(req, Body);
    return json(rt.setHitl(body.hitlEnabled));
  },
  { judge: true },
);
