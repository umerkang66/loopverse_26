import { json, readBody, route } from '@/server/http';
import { InterpretRequestSchema } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Preview only: interpretation + feasibility forecast. Nothing changes until /api/events/apply. */
export const POST = route(
  async (req, rt) => {
    const body = await readBody(req, InterpretRequestSchema);
    return json(await rt.interpretEvent(body));
  },
  { judge: true },
);
