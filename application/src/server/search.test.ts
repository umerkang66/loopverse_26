import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/types';
import { headlineFor, insightsFromSessions, searchSessions } from './search';

const msg = (seq: number, over: Record<string, unknown>) => ({
  id: `M-${String(seq).padStart(4, '0')}`,
  seq,
  scenarioId: 'S0',
  round: 1,
  phase: 'POSITIONS',
  from: 'LIFE_SUPPORT',
  to: 'ALL',
  type: 'OBJECTION',
  subtype: null,
  summary: '',
  body: '',
  planVersion: null,
  data: {},
  turnId: null,
  source: 'LLM',
  meta: null,
  createdAt: `2026-10-10T10:00:0${seq}.000Z`,
  ...over,
});

const session = (id: string, messages: unknown[], scenarios: unknown[] = [], plans: unknown[] = []) =>
  ({ id, messages, scenarios, plans }) as unknown as SessionState;

describe('file-mode search and insights', () => {
  const a = session(
    'aaaaaaaa-0000-0000-0000-000000000000',
    [
      msg(1, { subtype: 'SACRIFICE_REFUSAL', summary: 'HAVEN refuses L3', body: 'I refuse to sacrifice habitat air for a rover.' }),
      msg(2, { from: 'FOOD', subtype: 'SACRIFICE_REFUSAL', summary: 'VERDANT refuses F3', body: 'Crop yield would collapse; I refuse.' }),
      msg(3, { type: 'BRIEFING', summary: 'Round 2 opens', body: 'Oxygen reserve is thin.' }),
    ],
    [
      { id: 'S0', kind: 'BASELINE', outcome: 'APPROVED', round: 3, approvedPlanVersion: 2, startedAt: null, resolvedAt: null },
      { id: 'S1', kind: 'EVENT', outcome: 'APPROVED', round: 2, approvedPlanVersion: 4, startedAt: '2026-10-10T10:00:00.000Z', resolvedAt: '2026-10-10T10:00:46.000Z' },
    ],
    [
      { version: 2, sacrifices: ['ENGINEERING'] },
      { version: 4, sacrifices: ['LIFE_SUPPORT'] },
    ],
  );
  const b = session('bbbbbbbb-0000-0000-0000-000000000000', [msg(1, { summary: 'Refuse the crisis override', body: 'Nobody refuses.' })]);

  it('finds every term, ranks, and marks matches with « »', () => {
    const hits = searchSessions([a, b], a.id, 'refuse sacrifice', 10);
    expect(hits.map((h) => h.messageId)).toEqual(['M-0001']);
    expect(hits[0]).toMatchObject({ sessionId: a.id, isCurrentSession: true, subtype: 'SACRIFICE_REFUSAL', from: 'LIFE_SUPPORT', planVersion: null });
    expect(hits[0]!.headline).toContain('«refuse»');
  });

  it('searches across sessions and flags the current one', () => {
    const hits = searchSessions([a, b], a.id, 'refuse', 10);
    expect(hits).toHaveLength(3);
    expect(hits.filter((h) => !h.isCurrentSession)).toHaveLength(1);
    expect(searchSessions([a, b], a.id, 'nothing-matches-this', 10)).toEqual([]);
    expect(searchSessions([a], a.id, '   ', 10)).toEqual([]);
    expect(searchSessions([a, b], a.id, 'refuse', 2)).toHaveLength(2);
  });

  it('headlines are plain text: markup in agent text is never interpreted', () => {
    const h = headlineFor('<img src=x onerror=alert(1)> refuse', ['refuse']);
    expect(h).toContain('<img');
    expect(h).toContain('«refuse»');
  });

  it('insights match the SQL function shape', () => {
    expect(insightsFromSessions([a, b])).toEqual({
      sessions: 2,
      scenarios_by_outcome: { APPROVED: 2 },
      sacrifices_by_department: { ENGINEERING: 1, LIFE_SUPPORT: 1 },
      refusals_by_department: { LIFE_SUPPORT: 1, FOOD: 1 },
      avg_rounds_to_approval: 2.5,
      avg_event_resolution_seconds: 46,
    });
  });
});
