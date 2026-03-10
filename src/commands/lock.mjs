import chalk from 'chalk';
import { readRegistry, updatePackage, getPackage } from '../lib/registry.mjs';

export async function runLock(name, options) {
  const pkg = await getPackage(name);

  if (!pkg) {
    console.error(chalk.red(`\nPackage "${name}" not found in registry. Run \`ocpkg init\` first.\n`));
    process.exit(1);
  }

  if (pkg.lockedVersion) {
    console.log(chalk.yellow(`\nPackage "${name}" is already locked at ${pkg.lockedVersion}.`));
    if (pkg.lockReason) console.log(chalk.gray(`  Reason: ${pkg.lockReason}`));
    console.log();
    return;
  }

  const version = pkg.installedVersion || pkg.installedCommit || 'unknown';
  const reason = options.reason || '';

  await updatePackage(name, {
    lockedVersion: version,
    lockReason: reason || null,
  });

  console.log(chalk.green(`\n  🔒 Locked ${name} at ${version}`));
  if (reason) console.log(chalk.gray(`     Reason: ${reason}`));
  console.log(chalk.gray(`     Use \`ocpkg unlock ${name}\` to remove the lock.`));
  console.log(chalk.gray(`     Use \`ocpkg upgrade ${name} --force\` to upgrade anyway.\n`));
}

export async function runUnlock(name) {
  const pkg = await getPackage(name);

  if (!pkg) {
    console.error(chalk.red(`\nPackage "${name}" not found in registry. Run \`ocpkg init\` first.\n`));
    process.exit(1);
  }

  if (!pkg.lockedVersion) {
    console.log(chalk.gray(`\nPackage "${name}" is not locked.\n`));
    return;
  }

  const prevLock = pkg.lockedVersion;
  await updatePackage(name, {
    lockedVersion: null,
    lockReason: null,
  });

  console.log(chalk.green(`\n  🔓 Unlocked ${name} (was locked at ${prevLock})\n`));
}
