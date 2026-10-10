import 'server-only';
import { setDefaultOpenAIKey, setTracingDisabled } from '@openai/agents';
import type { ServerEnv } from '../env';

let initialized = false;

export function initAgentsSdk(env: ServerEnv): void {
  if (initialized) return;
  initialized = true;
  if (env.mode === 'live' && env.OPENAI_API_KEY) setDefaultOpenAIKey(env.OPENAI_API_KEY);
  setTracingDisabled(env.mode !== 'live' || env.OPENAI_TRACING === 'off');
}
