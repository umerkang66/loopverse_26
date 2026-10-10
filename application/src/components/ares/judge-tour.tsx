'use client';

import { useEffect, useState } from 'react';
import { Compass, Sparkles, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'ares.judgeTourSeen';

interface TourStep {
  title: string;
  badge: string;
  description: string;
  tip: string;
}

const STEPS: TourStep[] = [
  {
    title: 'Mission Control',
    badge: 'Overview',
    description:
      'Monitor colony vitals live. Gauges show Power, Water, Oxygen, Robot Time, and Bandwidth with department color-coding, required reserves, combined risk, and protocol stepper.',
    tip: 'Watch how resource bars change dynamically when an unseen event hits.',
  },
  {
    title: 'Judge Controls',
    badge: 'Start here',
    description:
      'Configure available resources, start the council, inject unseen emergencies (in plain prose or JSON), simulate supply deliveries, and test resilience faults.',
    tip: 'Click "Start crisis" to watch the five agents negotiate in real-time.',
  },
  {
    title: 'Council Transcript',
    badge: 'Live Negotiation',
    description:
      'Read every proposal, objection, counteroffer, commitment, and vote. Objections have red highlights; badges show provenance (LLM, FALLBACK, DETERMINISTIC, HUMAN).',
    tip: 'Click on any message or agent name to inspect their private memory and stance.',
  },
  {
    title: 'Mode Board & Validation',
    badge: 'Deterministic Gate',
    description:
      'Review each department’s package, consequence, and required return commitments. Every plan passes 10 strict deterministic checks outside the LLM before approval.',
    tip: 'If an event invalidates the plan, an unmistakable diagonal INVALID stamp appears.',
  },
  {
    title: 'Compliance & Feasibility',
    badge: 'Scoring & Proofs',
    description:
      'The Compliance tab verifies PDF challenge requirements in real-time. The Feasibility heatmap exhaustively proves which of the 81 combinations are possible.',
    tip: 'When a crisis is unresolvable, an Infeasibility Certificate calculates exact shortfalls.',
  },
];

export function JudgeTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const handleStart = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener('ares:startTour', handleStart);

    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // Auto-show after a short delay on first visit
        const timer = setTimeout(() => setOpen(true), 1200);
        return () => {
          clearTimeout(timer);
          window.removeEventListener('ares:startTour', handleStart);
        };
      }
    } catch {
      // storage unavailable
    }
    return () => window.removeEventListener('ares:startTour', handleStart);
  }, []);

  const close = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
    setOpen(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else close();
  };

  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  if (!open) return null;

  const cur = STEPS[step]!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Judge guided tour"
      className="fixed bottom-6 right-6 z-50 w-full max-w-md rounded-xl border border-mars/40 bg-panel/95 p-4 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <Compass className="size-4 text-mars" />
          <span className="text-xs font-semibold uppercase tracking-wider text-mars">Judge Tour · Step {step + 1} of {STEPS.length}</span>
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded p-1 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
          aria-label="Close tour"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-base text-foreground">{cur.title}</h4>
          <span className="rounded bg-mars/15 px-2 py-0.5 text-[10px] font-medium text-mars border border-mars/30">
            {cur.badge}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{cur.description}</p>
        <div className="mt-1 flex items-start gap-1.5 rounded-md bg-panel-2 p-2 border border-border/50 text-xs">
          <Sparkles className="size-3.5 shrink-0 text-amber mt-0.5" />
          <span className="text-muted-foreground"><strong className="text-foreground">Judge Tip:</strong> {cur.tip}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border/60">
        <div className="flex items-center gap-1">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-mars' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'}`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={prev}>
              <ChevronLeft className="size-3.5 mr-1" /> Back
            </Button>
          )}
          <Button size="sm" onClick={next}>
            {step === STEPS.length - 1 ? 'Finish' : 'Next'} <ChevronRight className="size-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function startTour() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('ares:startTour'));
  } catch {
    // ignore
  }
}
