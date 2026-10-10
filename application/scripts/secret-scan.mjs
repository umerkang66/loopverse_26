#!/usr/bin/env node
/**
 * Scans all tracked git files for secrets defined in .env
 * Usage: node scripts/secret-scan.mjs
 * Never prints secret values, only offending file paths.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
const secretsToFind = new Set();

if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (
      ['OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'DB_PASSWORD'].includes(key) &&
      value.length >= 6
    ) {
      secretsToFind.add(value);
    }
  }
}

let files = [];
try {
  const stdout = execSync('git ls-files', { encoding: 'utf8' });
  files = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
} catch {
  console.error('[secret-scan] Error running git ls-files');
  process.exit(1);
}

const foundInFiles = new Set();

for (const file of files) {
  // Never scan binary or ignored paths
  if (file.endsWith('.png') || file.endsWith('.ico') || file.endsWith('.zip')) continue;
  try {
    const fullPath = path.resolve(process.cwd(), file);
    if (!existsSync(fullPath)) continue;
    const text = readFileSync(fullPath, 'utf8');
    for (const secret of secretsToFind) {
      if (text.includes(secret)) {
        foundInFiles.add(file);
      }
    }
  } catch {
    // skip unreadable files
  }
}

if (foundInFiles.size > 0) {
  console.error(`\n[secret-scan] ✗ Secrets detected in ${foundInFiles.size} tracked file(s):`);
  for (const f of foundInFiles) {
    console.error(`  - ${f}`);
  }
  console.error('[secret-scan] Remove these secrets before committing.\n');
  process.exit(1);
} else {
  console.log(`\n[secret-scan] ✓ Clean: 0 secrets found across ${files.length} tracked files.\n`);
  process.exit(0);
}
