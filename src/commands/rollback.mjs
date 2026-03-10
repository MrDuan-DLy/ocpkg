import chalk from 'chalk';
import { readRegistry, writeRegistry } from '../lib/registry.mjs';
import { appendHistory } from '../lib/history.mjs';
import { findLatestBackup } from '../lib/backup.mjs';
import { checkout, getHeadCommit } from '../lib/git-ops.mjs';
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
function warn(msg) { console.log(chalk.yellow(`⚠ ${msg}`)); }

function findOpenclawBin() {
  for (const p of OPENCLAW_BIN_PATHS) {
    if (existsSync(p)) return p;
  }
  return 'openclaw';
}

async function runCommand(cmd, opts = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120000, ...opts });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err.message };
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

export async function runRollback(name, options) {
  const registry = await readRegistry();
  const pkg = registry.packages[name];

  if (!pkg) {
    console.error(chalk.red(`\nPackage "${name}" not found in registry.\n`));
    process.exit(1);
  }

  if (pkg.source === 'local') {
    console.error(chalk.yellow(`\nPackage "${name}" is a local package. Cannot rollback.\n`));
    process.exit(1);
  }

  // Find backup
  const backup = await findLatestBackup(name);
  if (!backup) {
    console.error(chalk.red(`\nNo backup found for "${name}". Run \`ocpkg upgrade\` first to create a backup.\n`));
    process.exit(1);
  }

  const { manifest } = backup;
  const pkgPath = expandHome(pkg.gitRoot || pkg.path);
  const openclaw = findOpenclawBin();

  const currentVersion = pkg.installedVersion || `@${pkg.installedCommit}`;
  const targetVersion = manifest.fromVersion || `@${manifest.fromCommitShort || manifest.fromCommit?.slice(0, 7)}`;
  const targetCommit = manifest.fromCommit;

  console.log(chalk.bold(`\nRolling back ${name}...\n`));
  console.log(`  Current: ${currentVersion}`);
  console.log(`  Target:  ${targetVersion} (backup from ${new Date(manifest.backupTime).toLocaleString()})`);
  console.log('');

  const TOTAL = pkg.requiresJitiClear && pkg.requiresRestart ? 5 :
    pkg.requiresJitiClear || pkg.requiresRestart ? 4 : 3;

  let stepN = 1;

  // Step 1: git checkout
  step(stepN++, TOTAL, `git checkout ${manifest.fromCommitShort || targetCommit?.slice(0, 7)}`);
  try {
    await checkout(pkgPath, targetCommit);
    ok();
  } catch (err) {
    console.log(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }

  // Step 2: npm install (if needed)
  if (pkg.hasNodeModules) {
    step(stepN++, TOTAL, 'Installing dependencies');
    const result = await runCommand(`npm install --omit=dev --quiet`, { cwd: pkgPath });
    if (result.ok) ok(); else warn('npm install failed');
  }

  // Step 3: Clear jiti cache
  if (pkg.requiresJitiClear) {
    step(stepN++, TOTAL, 'Clearing jiti cache');
    const result = await runCommand(`rm -rf /tmp/jiti/`);
    if (result.ok) ok(); else warn('jiti clear failed');
  }

  // Step 4: Restart gateway
  if (pkg.requiresRestart) {
    step(stepN++, TOTAL, 'Restarting OpenClaw gateway');
    const result = await runCommand(`${openclaw} gateway restart`);
    if (result.ok) ok(); else warn('gateway restart failed — restart manually');
  }

  // Get new (rolled back) version info
  const newVersion = await readPackageVersion(pkgPath);
  const newCommit = await getHeadCommit(pkgPath);

  // Update registry
  registry.packages[name] = {
    ...pkg,
    installedVersion: newVersion || manifest.fromVersion,
    installedCommit: newCommit || manifest.fromCommitShort,
    lastChecked: new Date().toISOString(),
  };
  await writeRegistry(registry);

  // Append to history
  await appendHistory({
    pkg: name,
    from: currentVersion,
    to: targetVersion,
    status: 'success',
    rollback: true,
  });

  console.log(chalk.bold.green(`\n  ✓ ${name} rolled back to ${targetVersion}\n`));
}
