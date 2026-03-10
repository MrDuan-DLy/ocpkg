import chalk from 'chalk';
import { readRegistry, writeRegistry } from '../lib/registry.mjs';
import { appendHistory } from '../lib/history.mjs';
import { createBackup, updateBackupManifest } from '../lib/backup.mjs';
import { pull, getHeadCommit, checkout, fetchRemote } from '../lib/git-ops.mjs';
import { expandHome, OPENCLAW_BIN_PATHS } from '../lib/paths.mjs';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function step(n, total, msg) {
  process.stdout.write(`  [${n}/${total}] ${msg.padEnd(45)}`);
}

function ok() { console.log(chalk.green('✓')); }
function fail(msg) { console.log(chalk.red(`✗ ${msg}`)); }
function warn(msg) { console.log(chalk.yellow(`⚠ ${msg}`)); }

function findOpenclawBin() {
  for (const p of OPENCLAW_BIN_PATHS) {
    if (existsSync(p)) return p;
  }
  // Try PATH
  return 'openclaw';
}

async function runCommand(cmd, opts = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000, ...opts });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
  }
}

async function readPackageVersion(pkgPath) {
  try {
    const raw = await readFile(join(pkgPath, 'package.json'), 'utf8');
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

async function rollbackPackage(pkgPath, fromCommit, pkg) {
  console.log(chalk.yellow('\n  Auto-rolling back...'));
  try {
    await checkout(pkgPath, fromCommit);
    if (pkg.hasNodeModules) {
      await runCommand(`npm install --omit=dev --quiet`, { cwd: pkgPath });
    }
    console.log(chalk.yellow('  Rolled back to previous state.'));
  } catch (err) {
    console.log(chalk.red(`  Rollback failed: ${err.message}`));
  }
}

export async function runUpgrade(name, options) {
  const registry = await readRegistry();
  const pkg = registry.packages[name];

  if (!pkg) {
    console.error(chalk.red(`\nPackage "${name}" not found in registry. Run \`ocpkg init\` first.\n`));
    process.exit(1);
  }

  if (pkg.lockedVersion && !options.force) {
    console.error(chalk.yellow(`\nPackage "${name}" is locked at ${pkg.lockedVersion}. Use --force to override.\n`));
    process.exit(1);
  }

  if (pkg.source === 'local') {
    console.error(chalk.yellow(`\nPackage "${name}" is a local package with no remote. Cannot upgrade.\n`));
    process.exit(1);
  }

  const pkgPath = expandHome(pkg.path);
  const openclaw = findOpenclawBin();
  const TOTAL = pkg.requiresJitiClear && pkg.requiresRestart ? 7 :
    pkg.requiresJitiClear || pkg.requiresRestart ? 6 : 5;

  console.log(chalk.bold(`\nUpgrading ${name}...\n`));
  console.log(`  Current: ${pkg.installedVersion || `@${pkg.installedCommit}`}`);

  // Step 1: Pre-flight
  let stepN = 1;
  step(stepN++, TOTAL, 'Pre-flight checks');
  await fetchRemote(pkgPath, pkg.remoteName || 'origin');
  ok();

  // Step 2: Backup
  step(stepN++, TOTAL, 'Backing up current state');
  let backup;
  try {
    backup = await createBackup(pkg);
    ok();
  } catch (err) {
    fail(err.message);
    process.exit(1);
  }

  const fromCommit = backup.manifest.fromCommit;
  const fromVersion = backup.manifest.fromVersion;

  // Step 3: Git pull
  step(stepN++, TOTAL, 'Pulling latest from remote');
  try {
    const branch = pkg.branch || 'master';
    await pull(pkgPath, pkg.remoteName || 'origin', branch);
    ok();
  } catch (err) {
    fail(err.message);
    await rollbackPackage(pkgPath, fromCommit, pkg);
    process.exit(1);
  }

  const newCommit = await getHeadCommit(pkgPath);
  const newVersion = await readPackageVersion(pkgPath);

  console.log(`  Target:  ${newVersion || `@${newCommit}`}`);

  // Update backup manifest with target info
  await updateBackupManifest(backup.backupPath, { toVersion: newVersion, toCommit: newCommit });

  // Step 4: npm install (if needed)
  if (pkg.hasNodeModules) {
    step(stepN++, TOTAL, 'Installing dependencies');
    const result = await runCommand(`npm install --omit=dev --quiet`, { cwd: pkgPath });
    if (result.ok) {
      ok();
    } else {
      fail('npm install failed');
      console.log(chalk.red(`    ${result.stderr || result.error}`));
      await rollbackPackage(pkgPath, fromCommit, pkg);
      process.exit(1);
    }
  }

  // Step 5: Validate (plugins only)
  if (pkg.type === 'plugin') {
    step(stepN++, TOTAL, 'Validating config');
    const result = await runCommand(`${openclaw} config validate`);
    if (result.ok) {
      ok();
    } else {
      warn('config validate failed (non-fatal)');
    }
  }

  // Step 6: Clear jiti cache
  if (pkg.requiresJitiClear) {
    step(stepN++, TOTAL, 'Clearing jiti cache');
    const result = await runCommand(`rm -rf /tmp/jiti/`);
    if (result.ok) ok(); else warn('jiti clear failed');
  }

  // Step 7: Restart gateway
  if (pkg.requiresRestart && !options.noRestart) {
    step(stepN++, TOTAL, 'Restarting OpenClaw gateway');
    const result = await runCommand(`${openclaw} gateway restart`);
    if (result.ok) {
      ok();
    } else {
      warn('gateway restart failed — restart manually');
    }
  } else if (pkg.requiresRestart && options.noRestart) {
    console.log(chalk.gray(`  [${stepN}/${TOTAL}] Gateway restart skipped (--no-restart)`));
    stepN++;
  }

  // Post-verify: check plugin is loaded
  if (pkg.type === 'plugin') {
    step(stepN++, TOTAL, 'Verifying plugin loaded');
    const result = await runCommand(`${openclaw} plugins list`);
    if (result.ok && result.stdout.includes(name)) {
      ok();
    } else {
      warn('could not verify plugin is loaded');
    }
  }

  // Update registry
  registry.packages[name] = {
    ...pkg,
    installedVersion: newVersion,
    installedCommit: newCommit,
    lastChecked: new Date().toISOString(),
  };
  await writeRegistry(registry);

  // Append to history
  await appendHistory({
    pkg: name,
    from: fromVersion || `@${fromCommit?.slice(0, 7)}`,
    to: newVersion || `@${newCommit}`,
    status: 'success',
    rollback: false,
  });

  console.log(chalk.bold.green(`\n  ✓ ${name} upgraded successfully`));
  if (fromVersion && newVersion) {
    console.log(chalk.gray(`    ${fromVersion} → ${newVersion}\n`));
  } else {
    console.log(chalk.gray(`    @${fromCommit?.slice(0, 7)} → @${newCommit}\n`));
  }
}
