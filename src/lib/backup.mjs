import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { BACKUPS_DIR } from './paths.mjs';
import { getHeadCommitFull, getHeadCommit } from './git-ops.mjs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Create a backup of the current state.
 * Uses git commit hash as primary backup reference + optional tarball.
 */
export async function createBackup(pkg) {
  const { name, path: pkgPath, installedVersion, installedCommit } = pkg;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupPath = join(BACKUPS_DIR, name, timestamp);

  await mkdir(backupPath, { recursive: true });

  // Get full commit hash
  const fromCommit = await getHeadCommitFull(pkgPath);
  const fromCommitShort = fromCommit ? fromCommit.slice(0, 7) : installedCommit;

  // Create tarball (excluding .git and node_modules)
  const tarballPath = join(backupPath, 'source.tar.gz');
  try {
    await execAsync(
      `tar czf "${tarballPath}" --exclude='.git' --exclude='node_modules' -C "${pkgPath}" .`,
      { timeout: 60000 }
    );
  } catch (err) {
    console.error(`  Warning: tarball creation failed: ${err.message}`);
  }

  const manifest = {
    package: name,
    backupTime: new Date().toISOString(),
    fromVersion: installedVersion,
    fromCommit: fromCommit || fromCommitShort,
    fromCommitShort,
    toVersion: null,
    toCommit: null,
    tarballPath: existsSync(tarballPath) ? tarballPath : null,
    timestamp,
  };

  await writeFile(join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { backupPath, manifest };
}

/**
 * Update backup manifest with post-upgrade info.
 */
export async function updateBackupManifest(backupPath, updates) {
  const manifestPath = join(backupPath, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  Object.assign(manifest, updates);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

/**
 * Find the most recent backup for a package.
 */
export async function findLatestBackup(name) {
  const pkgBackupDir = join(BACKUPS_DIR, name);
  if (!existsSync(pkgBackupDir)) return null;

  const entries = await readdir(pkgBackupDir, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse();

  if (dirs.length === 0) return null;

  const latestDir = join(pkgBackupDir, dirs[0]);
  const manifestPath = join(latestDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  const raw = await readFile(manifestPath, 'utf8');
  return { backupPath: latestDir, manifest: JSON.parse(raw) };
}

/**
 * List all backups for a package, sorted newest first.
 */
export async function listBackups(name) {
  const pkgBackupDir = join(BACKUPS_DIR, name);
  if (!existsSync(pkgBackupDir)) return [];

  const entries = await readdir(pkgBackupDir, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse();

  const results = [];
  for (const dir of dirs) {
    const manifestPath = join(pkgBackupDir, dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = await readFile(manifestPath, 'utf8');
      results.push({ backupPath: join(pkgBackupDir, dir), manifest: JSON.parse(raw) });
    } catch {}
  }
  return results;
}
