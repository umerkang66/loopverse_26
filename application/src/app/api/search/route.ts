import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ranked full-text search over every negotiation of this instance (Supabase), or the local archive. */
export const GET = route(async (req, rt) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  return json(await rt.search(url.searchParams.get('q') ?? '', Number.isFinite(limit) ? limit : 50));
}, {});
