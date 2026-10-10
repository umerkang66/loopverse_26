'use client';

import { useEffect, useState } from 'react';

/** Current time, re-rendering every `intervalMs` (for countdowns and "x s ago"). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
