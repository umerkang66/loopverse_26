import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import { GET as state } from '@/app/api/state/route';
import { GET as stream } from '@/app/api/stream/route';
import { POST as start } from '@/app/api/control/start/route';
import { POST as reset } from '@/app/api/control/reset/route';
import { POST as interpret } from '@/app/api/events/interpret/route';
import { POST as apply } from '@/app/api/events/apply/route';
import { GET as exportRoute } from '@/app/api/export/route';
import { GET as sessions } from '@/app/api/sessions/route';
import { GET as sessionById } from '@/app/api/sessions/[id]/route';
import type { AresRuntime } from '@/server/runtime';
import { offlineRuntime } from './helpers';

const URL_BASE = 'http://localhost:3000';
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (path: string, init: RequestInit = {}) => new Request(URL_BASE + path, init);
const noCtx = undefined as never;

let rt: AresRuntime;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const h = await offlineRuntime();
  rt = h.rt;
  cleanup = h.cleanup;
  globalThis.__aresRuntime = rt;
});
afterAll(async () => {
  globalThis.__aresRuntime = undefined;
  await cleanup();
});

describe('API routes (offline runtime, real handlers)', () => {
  it('health reports offline agents and the file store without leaking secrets', async () => {
    const res = await health(get('/api/health?deep=1'), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, mode: 'offline', storage: { driver: 'file' } });
    expect(JSON.stringify(body)).not.toMatch(/sk-|sb_secret_/);
  });

  it('rejects malformed bodies with 400 { error }', async () => {
    const bad = await start(new Request(URL_BASE + '/api/control/start', { method: 'POST', body: '{nope' }), noCtx);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/valid JSON/);
    const range = await start(post('/api/control/start', { resources: { power: -1, water: 1, oxygen: 1, robot: 1, bandwidth: 1 } }), noCtx);
    expect(range.status).toBe(400);
    const hard = await reset(post('/api/control/reset', { hard: true }), noCtx);
    expect(hard.status).toBe(400);
  });

  it('runs baseline → event through the API; 409 on a second start', async () => {
    const res = await start(post('/api/control/start', {}), noCtx);
    expect(res.status).toBe(202);
    expect((await start(post('/api/control/start', {}), noCtx)).status).toBe(409);
    await rt.waitForIdle();

    const preview = await interpret(post('/api/events/interpret', { kind: 'preset', presetId: 'PRACTICE_SOLAR' }), noCtx);
    expect(preview.status).toBe(200);
    const { interpretation, forecast } = await preview.json();
    expect(forecast.previousPlanWouldBe).toBe('INVALID');
    expect(forecast.feasibleBase).toBe(0);
    expect(forecast.feasibleOverride).toBeGreaterThan(0);

    const applied = await apply(post('/api/events/apply', { interpretation }), noCtx);
    expect(applied.status).toBe(202);
    expect((await applied.json()).scenarioId).toBe('S1');
    await rt.waitForIdle();

    const body = await (await state(get('/api/state'), noCtx)).json();
    expect(body.state.scenarios.map((s: { outcome: string }) => s.outcome)).toEqual(['APPROVED', 'APPROVED']);
    expect(body.messages.length).toBe(body.state.messageCount);
    expect(body.state.agents.COMMANDER.sessionItems).toBeUndefined();
  });

  it('SSE: a fresh client gets retry + state.updated at once', async () => {
    const abort = new AbortController();
    const res = await stream(get('/api/stream', { signal: abort.signal }), noCtx);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-transform');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('event: state.updated')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text.startsWith('retry: 2000')).toBe(true);
    abort.abort();
    await reader.cancel();
  });

  it('SSE: Last-Event-ID replays only newer events', async () => {
    const last = rt.bus.lastId();
    rt.mut.toast('info', 'replay-probe');
    const abort = new AbortController();
    const res = await stream(get('/api/stream', { signal: abort.signal, headers: { 'last-event-id': String(last) } }), noCtx);
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('replay-probe')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`id: ${last + 1}\nevent: toast`);
    expect(text).not.toContain('event: state.updated\ndata: {"type":"state.updated","state":{"id"');
    abort.abort();
    await reader.cancel();
  });

  it('exports: JSON labels FALLBACK, CSV is RFC 4180, final allocation follows the output schema', async () => {
    const jsonRes = await exportRoute(get('/api/export?format=json'), noCtx);
    expect(jsonRes.headers.get('content-disposition')).toMatch(/attachment; filename="ares-accord-.*\.json"/);
    const exported = await jsonRes.json();
    expect(exported.meta.fallbackMessages).toBeGreaterThan(0);
    expect(exported.meta.llmMessages).toBe(0);
    expect(exported.messages.every((m: { source: string }) => ['FALLBACK', 'DETERMINISTIC'].includes(m.source))).toBe(true);

    const csv = await (await exportRoute(get('/api/export?format=csv&kind=transcript'), noCtx)).text();
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('seq,timestamp,scenario,round,phase,plan_version,from,to,type,subtype,summary,body,source,model,latency_ms,fallback_reason,trace_id');
    expect(csv).toContain(',FALLBACK,rule-based,');
    for (const kind of ['plans', 'votes', 'commitments']) {
      const res = await exportRoute(get(`/api/export?format=csv&kind=${kind}`), noCtx);
      expect(res.status).toBe(200);
    }
    expect((await exportRoute(get('/api/export?format=csv&kind=nope'), noCtx)).status).toBe(400);

    const final = await (await exportRoute(get('/api/export?format=final'), noCtx)).json();
    expect(final.decision).toBe('APPROVED');
    expect(final.scenario.id).toBe('S1');
    expect(final.records).toHaveLength(4);
    expect(final.records.every((r: { vote: string }) => r.vote === 'APPROVE')).toBe(true);
    expect(final.return_agreement.length).toBeGreaterThanOrEqual(2);
    const baseline = await (await exportRoute(get('/api/export?format=final&scenario=S0'), noCtx)).json();
    expect(baseline.scenario.id).toBe('S0');
  });

  it('archive: reset keeps history; sessions/[id] serves the archived run; bad ids are 400', async () => {
    const before = rt.getSnapshot().id;
    expect((await reset(post('/api/control/reset', {}), noCtx)).status).toBe(200);
    const list = await (await sessions(get('/api/sessions'), noCtx)).json();
    expect(list.sessions.some((s: { id: string; status: string }) => s.id === before && s.status === 'archived')).toBe(true);
    const archived = await sessionById(get(`/api/sessions/${before}`), { params: Promise.resolve({ id: before }) });
    expect(archived.status).toBe(200);
    const body = await archived.json();
    expect(body.archived).toBe(true);
    expect(body.messages.length).toBeGreaterThan(20);
    const bad = await sessionById(get('/api/sessions/..%2F..%2Fetc'), { params: Promise.resolve({ id: '../../etc' }) });
    expect(bad.status).toBe(400);
    const exported = await exportRoute(get(`/api/export?format=final&sessionId=${before}`), noCtx);
    expect((await exported.json()).decision).toBe('APPROVED');
  });
});

describe('judge access code', () => {
  it('mutating routes return 401 without x-judge-code, and work with it', async () => {
    const h = await offlineRuntime({ JUDGE_ACCESS_CODE: 'mission-control-test' });
    const previous = globalThis.__aresRuntime;
    globalThis.__aresRuntime = h.rt;
    try {
      expect((await start(post('/api/control/start', {}), noCtx)).status).toBe(401);
      expect((await start(post('/api/control/start', {}, { 'x-judge-code': 'wrong' }), noCtx)).status).toBe(401);
      expect((await health(get('/api/health'), noCtx)).status).toBe(200);
      const ok = await start(post('/api/control/start', { maxRounds: 3 }, { 'x-judge-code': 'mission-control-test' }), noCtx);
      expect(ok.status).toBe(202);
      await h.rt.waitForIdle();
    } finally {
      globalThis.__aresRuntime = previous;
      await h.cleanup();
    }
  });
});
