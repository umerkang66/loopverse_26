import 'server-only';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';

let redactions: string[] = [];

/** Register secret values that must never appear in logs. */
export function registerRedactions(values: string[]): void {
  redactions = [...new Set([...redactions, ...values.filter((v) => v.length >= 6)])];
}

export function redact(text: string): string {
  let out = text;
  for (const secret of redactions) out = out.split(secret).join('[redacted]');
  return out.replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-[redacted]').replace(/sb_secret_[A-Za-z0-9_-]+/g, 'sb_secret_[redacted]');
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const detail = extra === undefined ? '' : ` ${extra instanceof Error ? extra.message : JSON.stringify(extra)}`;
  const line = redact(`[ares:${scope}] ${message}${detail}`);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => write('debug', scope, message, extra),
    info: (message: string, extra?: unknown) => write('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => write('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => write('error', scope, message, extra),
  };
}
