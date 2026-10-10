'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to browser console
    console.error('[ares:error-boundary]', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-lg rounded-xl border border-danger/40 bg-panel p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-danger/15 text-danger">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-wide text-foreground">Mission Control Alert</h1>
            <p className="text-xs text-muted-foreground">A component runtime issue occurred</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-foreground/90 leading-relaxed">
          {error.message || 'An unexpected rendering error occurred in Mission Control.'}
        </p>

        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            Digest: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()} className="gap-1.5">
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Reload Mission Control
          </Button>
        </div>
      </div>
    </div>
  );
}
