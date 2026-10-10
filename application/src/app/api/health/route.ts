import { json, route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, rt) => {
  const deep = new URL(req.url).searchParams.get('deep') === '1';
  return json({ ...(await rt.health(deep)), version: process.env.npm_package_version ?? '0.1.0' });
});
