import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aggregates across all sessions: outcomes, sacrifices, refusals, rounds to approval, event resolution time. */
export const GET = route(async (_req, rt) => json(await rt.insights()), {});
