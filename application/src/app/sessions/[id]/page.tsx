import type { Metadata } from 'next';
import { ArchivedSession } from '@/components/ares/session-archive';

export const metadata: Metadata = { title: 'ARES ACCORD · Archived session' };

export default async function ArchivedSessionPage({ params }: PageProps<'/sessions/[id]'>) {
  const { id } = await params;
  return <ArchivedSession id={id} />;
}
