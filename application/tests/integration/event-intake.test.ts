import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setTracingDisabled } from '@openai/agents';
import { ScriptedModel, assistantMessage, modelResponse } from '@openai/agents/testing';
import { offlineRuntime } from './helpers';

const intake = (effects: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Airlock accident',
    summary: 'Two crew injured; Medical may not sacrifice and oxygen is reserved.',
    effects,
    durationHours: null,
    triggerHour: null,
    requiresReplan: true,
    messageToCommander: null,
    confidence: 0.9,
    assumptions: [],
    ...extra,
  });
const fx = (o: Record<string, unknown>) => ({ resource: null, value: null, modeId: null, department: null, sourceKey: null, note: 'n', ...o });

describe('Event Intake (hybrid pipeline, scripted model)', () => {
  beforeAll(() => setTracingDisabled(true));
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => void (await cleanup?.()));

  it('fast path: a fully understood JSON never calls the model', async () => {
    const model = new ScriptedModel([]);
    const o = await offlineRuntime({}, model);
    cleanup = o.cleanup;
    const { interpretation } = await o.rt.interpretEvent({ kind: 'json', input: { impact: { water: -6 } } });
    expect(interpretation.source).toBe('DETERMINISTIC');
    expect(interpretation.effects[0]).toMatchObject({ type: 'RESOURCE_DELTA', resource: 'water', value: -6, origin: 'parser' });
    expect(model.calls).toHaveLength(0);
  });

  it('prose: parser wins on what it read, the LLM fills the gap, bad effects are dropped', async () => {
    const model = new ScriptedModel([
      modelResponse([
        assistantMessage(
          intake([
            fx({ type: 'FORBID_MODE', modeId: 'M3' }),
            fx({ type: 'RESERVE_REQUIREMENT', resource: 'oxygen', value: 9 }), // disagrees with the parser's 3
            fx({ type: 'PRIORITY', department: 'MEDICAL' }),
            fx({ type: 'RISK_LIMIT', value: 999 }), // out of bounds → dropped
          ]),
        ),
      ]),
    ]);
    const o = await offlineRuntime({}, model);
    cleanup = o.cleanup;
    const text = 'Airlock accident: two more crew injured. Medical cannot drop to Sacrifice mode, and Mission Control orders 3 Oxygen units held in reserve.';
    const { interpretation, forecast } = await o.rt.interpretEvent({ kind: 'text', input: text });
    expect(interpretation.source).toBe('HYBRID');
    const byType = (t: string) => interpretation.effects.filter((e) => e.type === t);
    expect(byType('RESERVE_REQUIREMENT')).toEqual([expect.objectContaining({ resource: 'oxygen', value: 3, origin: 'parser' })]);
    expect(byType('PRIORITY')).toEqual([expect.objectContaining({ department: 'MEDICAL', origin: 'llm' })]);
    expect(byType('RISK_LIMIT')).toHaveLength(0);
    expect(interpretation.warnings.join(' ')).toMatch(/risk limit/i);
    expect(interpretation.warnings.join(' ')).toMatch(/disagreed/i);
    expect(forecast.poolAfter.oxygen).toBe(59);
  });

  it('LLM failure degrades to the labeled deterministic parse', async () => {
    const model = new ScriptedModel([modelResponse([assistantMessage('not json at all')])]);
    const o = await offlineRuntime({}, model);
    cleanup = o.cleanup;
    const { interpretation } = await o.rt.interpretEvent({ kind: 'text', input: 'Relay satellite lost — bandwidth halved.' });
    expect(interpretation.warnings[0]).toMatch(/Event Intake offline/);
    expect(interpretation.effects).toContainEqual(expect.objectContaining({ type: 'RESOURCE_PERCENT', resource: 'bandwidth', value: -50 }));
  });

  it('offline mode without a model also labels the deterministic parse', async () => {
    const o = await offlineRuntime();
    cleanup = o.cleanup;
    const { interpretation } = await o.rt.interpretEvent({ kind: 'text', input: 'Cascade failure: power −6, oxygen −2, robot time −3.' });
    expect(interpretation.warnings[0]).toMatch(/Event Intake offline/);
    expect(interpretation.effects).toHaveLength(3);
  });
});
