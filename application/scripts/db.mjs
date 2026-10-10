#!/usr/bin/env node
// Supabase helpers: push · check · advisors · types.
// Cross-platform (runs the locally installed CLI with Node, no shell). Never prints a key or password.
import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import { existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // no .env: pass --db-url explicitly, or link the project
}

const TABLES = [
  'ares_sessions', 'ares_instances', 'ares_scenarios', 'ares_events', 'ares_plans', 'ares_plan_validations',
  'ares_votes', 'ares_commitments', 'ares_messages', 'ares_agent_states', 'ares_agent_memory',
];
const CLI = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
const [command, ...extra] = process.argv.slice(2);

function projectRef() {
  try {
    return new URL(process.env.SUPABASE_URL ?? '').hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

const POOLER_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-central-1', 'eu-central-2', 'eu-north-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
];

/** Can this machine open a TCP connection to the (usually IPv6-only) direct database host? */
async function directReachable(host) {
  const addrs = await dns.resolve6(host).catch(() => []);
  const v4 = await dns.resolve4(host).catch(() => []);
  const candidates = [...v4.map((a) => [a, 4]), ...addrs.map((a) => [a, 6])];
  for (const [address, family] of candidates) {
    const ok = await new Promise((resolve) => {
      const s = net.connect({ host: address, port: 5432, family, timeout: 4000 });
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('timeout', () => (s.destroy(), resolve(false)));
      s.once('error', () => resolve(false));
    });
    if (ok) return true;
  }
  return false;
}

/**
 * Finds the Supavisor session pooler (IPv4) for this project WITHOUT sending a password: a Postgres StartupMessage
 * carrying only the user name gets an authentication request from the right region and "Tenant or user not found" elsewhere.
 */
async function findPooler(ref) {
  const startup = () => {
    const params = Buffer.from(`user\0postgres.${ref}\0database\0postgres\0\0`);
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + params.length, 0);
    head.writeInt32BE(196608, 4);
    return Buffer.concat([head, params]);
  };
  const probe = (host) =>
    new Promise((resolve) => {
      const raw = net.connect({ host, port: 5432, timeout: 7000 });
      const done = (v) => (raw.destroy(), resolve(v));
      raw.once('timeout', () => done(false));
      raw.once('error', () => done(false));
      raw.once('connect', () => {
        const ssl = Buffer.alloc(8);
        ssl.writeInt32BE(8, 0);
        ssl.writeInt32BE(80877103, 4);
        raw.write(ssl);
        raw.once('data', (d) => {
          if (d[0] !== 0x53) return done(false);
          // Discovery only (no credentials sent), so the Supabase-signed certificate is not verified here.
          const sock = tls.connect({ socket: raw, servername: host, rejectUnauthorized: false }, () => sock.write(startup()));
          sock.once('data', (m) => done(String.fromCharCode(m[0]) === 'R'));
          sock.once('error', () => done(false));
        });
      });
    });
  const hosts = POOLER_REGIONS.flatMap((r) => [`aws-0-${r}.pooler.supabase.com`, `aws-1-${r}.pooler.supabase.com`]);
  const results = await Promise.all(hosts.map(async (h) => [h, await probe(h)]));
  return results.find(([, ok]) => ok)?.[0] ?? null;
}

/**
 * Which database the CLI targets, in order: explicit flags → SUPABASE_DB_URL → a linked project → built from
 * SUPABASE_URL + DB_PASSWORD: the direct host when reachable, else the session pooler (SUPABASE_POOLER_HOST or discovered).
 */
async function target() {
  if (extra.some((a) => a === '--linked' || a === '--local' || a.startsWith('--db-url'))) return { args: [], note: null };
  if (process.env.SUPABASE_DB_URL) return { args: ['--db-url', process.env.SUPABASE_DB_URL], note: 'target: SUPABASE_DB_URL' };
  if (existsSync(path.join(root, 'supabase', '.temp', 'project-ref'))) return { args: ['--linked'], note: 'target: linked project' };
  const ref = projectRef();
  const password = process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (!ref || !password) {
    console.error('No database target: set SUPABASE_URL + DB_PASSWORD in .env, set SUPABASE_DB_URL, run "npx supabase link --project-ref <ref>", or pass --db-url.');
    process.exit(2);
  }
  const secret = encodeURIComponent(password);
  const direct = `db.${ref}.supabase.co`;
  if (await directReachable(direct)) {
    return { args: ['--db-url', `postgresql://postgres:${secret}@${direct}:5432/postgres`], note: 'target: direct database connection (from SUPABASE_URL + DB_PASSWORD)' };
  }
  const pooler = process.env.SUPABASE_POOLER_HOST || (await findPooler(ref));
  if (!pooler) {
    console.error('The direct database host is IPv6-only and unreachable from here, and no session pooler answered.\nSet SUPABASE_DB_URL to the Session pooler string from Dashboard → Connect, or apply the migration in the SQL Editor.');
    process.exit(2);
  }
  return {
    args: ['--db-url', `postgresql://postgres.${ref}:${secret}@${pooler}:5432/postgres`],
    note: `target: session pooler ${pooler} (the direct host is IPv6-only here); set SUPABASE_POOLER_HOST to skip discovery`,
  };
}

/** The CLI gets only what it needs: the DB password (as SUPABASE_DB_PASSWORD) and an optional access token. */
function cliEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('SUPABASE_') || k.startsWith('NEXT_PUBLIC_') || k === 'OPENAI_API_KEY' || k === 'DB_PASSWORD' || k === 'JUDGE_ACCESS_CODE') continue;
    env[k] = v;
  }
  const password = process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD;
  if (password) env.SUPABASE_DB_PASSWORD = password;
  if (process.env.SUPABASE_ACCESS_TOKEN) env.SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  return env;
}

function runCli(args, { capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: root, env: cliEnv(), stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'] });
    let out = '';
    if (capture) child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

async function check() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required in .env (the app runs in file mode without them).');
    process.exit(2);
  }
  if (!key.startsWith('sb_secret_')) console.warn('Note: SUPABASE_SECRET_KEY is not an sb_secret_ key; the legacy service_role JWT also works.');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  console.log(`Supabase project ${new URL(url).host}: checking ${TABLES.length} tables as service_role`);
  let failures = 0;
  for (const table of TABLES) {
    const { error, count, status } = await sb.from(table).select('*', { count: 'exact' }).limit(0);
    let verdict = `OK (${count ?? 0} rows)`;
    if (error) {
      failures++;
      const code = error.code ?? '';
      verdict =
        code === '42501'
          ? 'MISSING GRANT (42501): run the GRANT block of the migration'
          : code === 'PGRST205' || code === '42P01'
            ? 'MISSING TABLE: run the migration (npm run db:push, or paste it into the SQL Editor)'
            : status === 401 || /api key/i.test(error.message)
              ? 'REJECTED KEY (401): check SUPABASE_SECRET_KEY'
              : `ERROR ${code || status}: ${error.message}`;
    }
    console.log(`  ${table.padEnd(24)} ${verdict}`);
  }
  if (failures) {
    console.error(`\n${failures} of ${TABLES.length} tables are not usable. The app keeps working on the local snapshot until they are.`);
    process.exit(1);
  }
  console.log('\nAll tables reachable. Writes go through the write-behind sync; see /api/health?deep=1.');
}

async function main() {
  switch (command) {
    case 'push': {
      const t = await target();
      if (t.note) console.log(t.note);
      const { code } = await runCli(['db', 'push', ...t.args, ...extra]);
      if (code === 0) console.log('\nMigration step finished. Next: npm run db:check');
      process.exit(code);
      break;
    }
    case 'advisors': {
      const t = await target();
      if (t.note) console.log(t.note);
      const { code } = await runCli(['db', 'advisors', ...t.args, '--type', 'all', '--level', 'warn', '--fail-on', 'warn', ...extra]);
      process.exit(code);
      break;
    }
    case 'types': {
      const t = await target();
      if (t.note) console.error(t.note);
      const { code, out } = await runCli(['gen', 'types', 'typescript', ...t.args, '--schema', 'public', ...extra], { capture: true });
      if (code !== 0 || !out.trim()) process.exit(code || 1);
      const file = path.join(root, 'src', 'server', 'db', 'database.types.ts');
      writeFileSync(file, out);
      console.log(`Wrote ${path.relative(root, file)}`);
      break;
    }
    case 'check':
      await check();
      break;
    default:
      console.log('Usage: node scripts/db.mjs <push|check|advisors|types> [extra Supabase CLI flags, e.g. --db-url "<pooler url>" --yes]');
      process.exit(command ? 2 : 0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
