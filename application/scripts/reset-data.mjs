#!/usr/bin/env node
// Deletes the local data directory (snapshots and the file-mode archive). Supabase rows are untouched:
// use the hard reset in the app (or the API) to delete this instance's sessions from the database.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // defaults apply
}

const dir = path.resolve(root, process.env.DATA_DIR?.trim() || './data');
const rel = path.relative(root, dir);
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
  console.error(`Refusing to delete ${dir}: DATA_DIR must be a folder inside the application directory.`);
  process.exit(2);
}
if (!existsSync(dir)) {
  console.log(`Nothing to delete: ${rel} does not exist.`);
  process.exit(0);
}
const entries = readdirSync(dir);
if (!process.argv.includes('--yes')) {
  console.log(`This deletes ${entries.length} item(s) in ${rel}/ (local snapshots and archive). Re-run with --yes to confirm:`);
  console.log('  npm run reset:data -- --yes');
  process.exit(1);
}
for (const entry of entries) rmSync(path.join(dir, entry), { recursive: true, force: true });
console.log(`Deleted the contents of ${rel}/. Stop the dev server first, or it writes a fresh snapshot.`);
