import { json, readBody, route } from '@/server/http';
import { FaultRequestSchema } from '@/server/faults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resilience Lab: inject a labeled fault. */
export const POST = route(
  async (req, rt) => {
    const body = await readBody(req, FaultRequestSchema);
    return json(await rt.injectFault(body), 202);
  },
  { judge: true },
);

export const GET = route(async (_req, rt) => json(rt.faultStatus()), {});
