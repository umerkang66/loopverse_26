import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (_req, rt) => json(await rt.resume(), 202), { judge: true });
