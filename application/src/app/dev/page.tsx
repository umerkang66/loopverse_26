import type { Metadata } from 'next';
import { DevConsole } from './dev-console';

export const metadata: Metadata = {
  title: 'ARES ACCORD · Debug console',
  robots: { index: false },
};

export default function DevPage() {
  return <DevConsole />;
}
