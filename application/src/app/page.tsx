import { LiveDashboard } from '@/components/ares/dashboard';

/** Mission Control. `?debug=1` adds a link to the Phase 1 debug console. */
export default async function Home({ searchParams }: PageProps<'/'>) {
  const { debug } = await searchParams;
  return <LiveDashboard debug={debug === '1'} />;
}
