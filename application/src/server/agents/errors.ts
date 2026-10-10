import 'server-only';

export type LlmErrorKind =
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'MODEL_NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INVALID_OUTPUT'
  | 'NETWORK'
  | 'UNKNOWN';

export interface ClassifiedLlmError {
  kind: LlmErrorKind;
  message: string;
  issues: string[];
}

/**
 * Classify by `name` / HTTP `status` rather than instanceof: the Agents SDK is loaded by Node outside the bundle,
 * so class identity is not reliable across module copies.
 */
export function classifyLlmError(err: unknown): ClassifiedLlmError {
  const e = (err ?? {}) as { name?: string; status?: number; message?: string; constructor?: { name?: string }; result?: unknown };
  const name = e.name && e.name !== 'Error' ? e.name : (e.constructor?.name ?? 'Error');
  const message = String(e.message ?? err ?? 'unknown error').slice(0, 400);
  const status = typeof e.status === 'number' ? e.status : undefined;
  const issues: string[] = [];

  if (name === 'OutputGuardrailTripwireTriggered') {
    const info = (e.result as { output?: { outputInfo?: unknown } } | undefined)?.output?.outputInfo;
    if (Array.isArray(info)) issues.push(...info.map(String));
    return { kind: 'INVALID_OUTPUT', message, issues };
  }
  if (name === 'ModelTimeoutError' || name === 'TimeoutError' || name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(message)) {
    return { kind: 'TIMEOUT', message, issues };
  }
  if (status === 429 || name === 'RateLimitError') return { kind: 'RATE_LIMIT', message, issues };
  if (status === 401 || status === 403 || name === 'AuthenticationError' || name === 'PermissionDeniedError') {
    return { kind: 'AUTH', message, issues };
  }
  if (status === 404 || name === 'NotFoundError') return { kind: 'MODEL_NOT_FOUND', message, issues };
  if (status === 400 || name === 'BadRequestError') return { kind: 'BAD_REQUEST', message, issues };
  if (
    ['ModelBehaviorError', 'MaxTurnsExceededError', 'ModelRefusalError', 'InvalidToolInputError', 'ZodError', 'SyntaxError'].includes(name)
  ) {
    return { kind: 'INVALID_OUTPUT', message, issues };
  }
  if ((status !== undefined && status >= 500) || name === 'APIConnectionError' || name === 'InternalServerError' || /fetch failed|ECONN|ENOTFOUND|socket/i.test(message)) {
    return { kind: 'NETWORK', message, issues };
  }
  return { kind: 'UNKNOWN', message, issues };
}
