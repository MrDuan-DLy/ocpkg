import { homedir } from 'os';
import { join } from 'path';

export const HOME = homedir();

export function expandHome(p) {
  if (p.startsWith('~/')) return join(HOME, p.slice(2));
  return p;
}

export const OPENCLAW_DIR = join(HOME, '.openclaw');
export const WORKSPACE_DIR = join(OPENCLAW_DIR, 'workspace');
export const PLUGINS_DIR = join(WORKSPACE_DIR, 'plugins');
export const SKILLS_DIR = join(WORKSPACE_DIR, 'skills');

export const OCPKG_DIR = join(OPENCLAW_DIR, 'ocpkg');
export const REGISTRY_PATH = join(OCPKG_DIR, 'registry.json');
export const HISTORY_PATH = join(OCPKG_DIR, 'history.jsonl');
export const BACKUPS_DIR = join(OCPKG_DIR, 'backups');

export function backupDir(name, timestamp) {
  return join(BACKUPS_DIR, name, timestamp);
}

// Common locations to look for the openclaw binary
export const OPENCLAW_BIN_PATHS = [
  join(HOME, '.npm-global', 'bin', 'openclaw'),
  join(HOME, '.local', 'bin', 'openclaw'),
  '/usr/local/bin/openclaw',
  '/usr/bin/openclaw',
];
