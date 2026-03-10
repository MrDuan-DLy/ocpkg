import { appendFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { HISTORY_PATH } from './paths.mjs';

export async function appendHistory(entry) {
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
  });
  await appendFile(HISTORY_PATH, line + '\n', 'utf8');
}

export async function readHistory(filterName = null) {
  if (!existsSync(HISTORY_PATH)) return [];
  const raw = await readFile(HISTORY_PATH, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const entries = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  if (filterName) return entries.filter(e => e.pkg === filterName);
  return entries;
}
