import { z } from 'zod';
import { json, readBody, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ interpretation: z.unknown() });

/** The interpretation's full shape is validated by the runtime (InterpretationSchema). */
export const POST = route(
  async (req, rt) => {
    const { interpretation } = await readBody(req, Body);
    return json(await rt.applyEvent(interpretation), 202);
  },
  { judge: true },
);
