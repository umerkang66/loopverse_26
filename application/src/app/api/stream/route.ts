import type { StreamEvent } from '@/server/bus';
import { route } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events. Replays buffered events after `Last-Event-ID`; a fresh client (or one whose id fell out of the
 * ring buffer) gets the current `state.updated` and refetches /api/state for the transcript.
 */
export const GET = route(async (req, rt) => {
  const header = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('lastEventId');
  const lastId = Number.parseInt(header ?? '0', 10) || 0;
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (id: number, evt: StreamEvent) => write(`id: ${id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);

      write('retry: 2000\n\n');
      const replay = rt.bus.since(lastId);
      if (replay === null || lastId <= 0) send(rt.bus.lastId(), { type: 'state.updated', state: rt.getPublicState() });
      else for (const { id, event } of replay) send(id, event);

      const unsubscribe = rt.bus.subscribe(send);
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      req.signal.addEventListener('abort', () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
