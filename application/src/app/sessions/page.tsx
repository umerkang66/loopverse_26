import type { Metadata } from 'next';
import { SessionArchive } from '@/components/ares/session-archive';

export const metadata: Metadata = { title: 'ARES ACCORD · Session Archive' };

export default function SessionsPage() {
  return <SessionArchive />;
}
