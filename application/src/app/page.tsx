import Link from 'next/link';

/** Placeholder until Phase 2 builds the Mission Control interface here. */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">ARES ACCORD</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Mars colony crisis council: five AI agents negotiate resource allocations under a deterministic validator.
      </p>
      <p>
        <Link className="underline" href="/dev">
          Open the debug console
        </Link>{' '}
        to run a negotiation.
      </p>
    </main>
  );
}
