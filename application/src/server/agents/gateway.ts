import 'server-only';
import { run, type AgentInputItem } from '@openai/agents';
import type { AgentId, LlmMeta } from '@/domain/types';
import type { ServerEnv } from '../env';
import { logger } from '../logger';
import type { AgentRunContext } from './context';
import { classifyLlmError } from './errors';
import type { AgentFactory, AgentKind } from './factory';
import { keepLastMessages, type AgentSessions } from './sessions';

const log = logger('gateway');

export interface TurnRequest<T> {
  agentId: AgentId;
  kind: AgentKind;
  packet: string;
  context: AgentRunContext;
  /** Fatal semantic issues → one repair retry. */
  validate?: (output: T) => string[];
  /** Rule-based policy used when the LLM cannot deliver (labeled FALLBACK). */
  fallback: () => T;
  /** Hard abort (reset / new event): rethrown, never falls back. */
  abortSignal: AbortSignal;
  /** Soft stop (scenario deadline): the turn completes with the fallback. */
  deadlineSignal?: AbortSignal;
  traceId?: string;
}

export interface TurnResult<T> {
  output: T;
  source: 'LLM' | 'FALLBACK';
  meta: LlmMeta;
}

export type FaultDirective = 'OUTAGE' | 'CORRUPT' | 'DROP' | null;

export interface GatewayHooks {
  sessionId(): string;
  sessionItems(agentId: AgentId): unknown[];
  onSessionItems(agentId: AgentId, items: unknown[]): void;
  onStats(agentId: AgentId, delta: { llm: boolean; latencyMs: number; inputTokens: number; outputTokens: number }): void;
  onNotice(level: 'info' | 'warning' | 'error' | 'success', text: string): void;
}

function repairPacket(packet: string, issues: string[]): string {
  return `${packet}\n\nYOUR PREVIOUS OUTPUT WAS REJECTED: ${issues.join('; ')}. Return a corrected JSON object.`;
}

/** Every LLM call goes through here: timeouts, repair retry, error classification, failover, circuit breaker, fallback. */
export class AgentGateway {
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private forcedOffline: string | null = null;
  /** Phase 3 Resilience Lab hook. */
  fault: (agentId: AgentId, kind: AgentKind) => FaultDirective = () => null;
  /** Resilience Lab: while true every LLM call is short-circuited with a simulated connection failure. */
  outage: () => boolean = () => false;

  constructor(
    private readonly env: ServerEnv,
    private readonly factory: AgentFactory,
    private readonly sessions: AgentSessions,
    private readonly hooks: GatewayHooks,
  ) {}

  get mode(): 'live' | 'offline' {
    return this.env.mode === 'offline' || this.forcedOffline ? 'offline' : 'live';
  }

  circuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  async run<T>(req: TurnRequest<T>): Promise<TurnResult<T>> {
    const started = Date.now();
    if (this.env.mode === 'offline') return this.fallback(req, 'offline', started, 0, false);
    if (this.forcedOffline) return this.fallback(req, this.forcedOffline, started, 0, false);
    if (this.outage()) return this.fallback(req, 'simulated OpenAI outage (APIConnectionError)', started, 0, true);
    if (this.circuitOpen()) return this.fallback(req, 'circuit-open', started, 0, false);

    let input = req.packet;
    let attempts = 0;
    let extraTries = 0;
    let lastReason = 'unknown';
    let corrupted = false;
    while (attempts < 2 + extraTries && attempts < 4) {
      attempts++;
      const model = this.factory.modelFor(req.agentId);
      const signals = [req.abortSignal, AbortSignal.timeout(this.env.AGENT_TURN_TIMEOUT_MS)];
      if (req.deadlineSignal) signals.push(req.deadlineSignal);
      const signal = AbortSignal.any(signals);
      try {
        const fault = this.fault(req.agentId, req.kind);
        if (fault === 'OUTAGE') throw Object.assign(new Error('fetch failed (simulated OpenAI outage)'), { name: 'APIConnectionError' });
        if (fault === 'DROP' && attempts === 1) throw Object.assign(new Error('message dropped in transit (simulated)'), { name: 'TimeoutError' });
        const agent = this.factory.get(req.agentId, req.kind);
        const session = this.sessions.get(this.hooks.sessionId(), req.agentId, this.hooks.sessionItems(req.agentId));
        const result = await run(agent, input, {
          context: req.context,
          session,
          sessionInputCallback: (history: AgentInputItem[], newItems: AgentInputItem[]) => [...keepLastMessages(history, 6), ...newItems],
          signal,
          maxTurns: req.kind === 'synthesis' ? 6 : 4,
        });
        const output = result.finalOutput as T | undefined;
        if (output === undefined || output === null) throw Object.assign(new Error('empty final output'), { name: 'ModelBehaviorError' });
        if (fault === 'CORRUPT' && !corrupted) {
          corrupted = true;
          throw Object.assign(new Error('invalid JSON — fault injected'), { name: 'ModelBehaviorError' });
        }
        const issues = req.validate?.(output) ?? [];
        if (issues.length) {
          lastReason = `invalid-output: ${issues.join('; ')}`;
          if (attempts < 2) {
            input = repairPacket(req.packet, issues);
            continue;
          }
          break;
        }
        // success
        this.hooks.onSessionItems(req.agentId, await session.getItems());
        const usage = result.runContext.usage;
        const latencyMs = Date.now() - started;
        this.hooks.onStats(req.agentId, { llm: true, latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
        if (this.consecutiveFailures >= 4 || this.circuitOpenUntil > 0) this.hooks.onNotice('success', 'LLM restored: agents are live again.');
        this.circuitOpenUntil = 0;
        this.consecutiveFailures = 0;
        return {
          output,
          source: 'LLM',
          meta: {
            model,
            latencyMs,
            attempts,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            traceId: req.traceId,
            toolCalls: toolCallsOf(result.newItems),
          },
        };
      } catch (err) {
        if (req.abortSignal.aborted) throw err;
        if (req.deadlineSignal?.aborted) return this.fallback(req, 'deadline', started, attempts, false);
        const c = classifyLlmError(err);
        lastReason = `${c.kind.toLowerCase()}: ${c.message.slice(0, 160)}`;
        log.warn(`${req.agentId}/${req.kind} attempt ${attempts} failed`, lastReason);
        if (c.kind === 'AUTH') {
          this.forcedOffline = 'auth';
          this.hooks.onNotice('error', 'OpenAI rejected the API key: all agents switched to labeled rule-based FALLBACK.');
          break;
        }
        if (c.kind === 'MODEL_NOT_FOUND') {
          if (this.factory.markUnavailable(model)) {
            this.hooks.onNotice('warning', `Model ${model} unavailable → using ${this.factory.modelFor(req.agentId)}.`);
            extraTries++;
            continue;
          }
          break;
        }
        if (c.kind === 'BAD_REQUEST') {
          if (this.factory.disableExtras()) {
            this.hooks.onNotice('warning', 'Model rejected optional parameters (verbosity/reasoning); retrying without them.');
            extraTries++;
            continue;
          }
          break;
        }
        if (c.kind === 'INVALID_OUTPUT' && attempts < 2) input = repairPacket(req.packet, c.issues.length ? c.issues : [c.message]);
      }
    }
    return this.fallback(req, lastReason, started, attempts, true);
  }

  private fallback<T>(req: TurnRequest<T>, reason: string, started: number, attempts: number, failure: boolean): TurnResult<T> {
    if (failure) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 4) {
        this.circuitOpenUntil = Date.now() + 60_000;
        this.hooks.onNotice('warning', 'LLM failing repeatedly: circuit open for 60 s, agents run on labeled rule-based FALLBACK.');
      }
    }
    const output = req.fallback();
    const latencyMs = Date.now() - started;
    this.hooks.onStats(req.agentId, { llm: false, latencyMs, inputTokens: 0, outputTokens: 0 });
    return { output, source: 'FALLBACK', meta: { model: 'rule-based', latencyMs, attempts, fallbackReason: reason, toolCalls: [] } };
  }
}

function toolCallsOf(items: readonly unknown[]): LlmMeta['toolCalls'] {
  const calls: { name: string; args: string }[] = [];
  const outputs: string[] = [];
  for (const raw of items) {
    const item = raw as { type?: string; rawItem?: { name?: string; arguments?: string }; output?: unknown };
    if (item.type === 'tool_call_item') calls.push({ name: item.rawItem?.name ?? 'tool', args: String(item.rawItem?.arguments ?? '').slice(0, 200) });
    if (item.type === 'tool_call_output_item') outputs.push(typeof item.output === 'string' ? item.output : JSON.stringify(item.output));
  }
  return calls.map((c, i) => ({ ...c, result: (outputs[i] ?? '').slice(0, 240) }));
}
