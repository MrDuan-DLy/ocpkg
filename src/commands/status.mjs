import chalk from 'chalk';
import Table from 'cli-table3';
import { readRegistry, writeRegistry } from '../lib/registry.mjs';
import { fetchRemote, commitsBehind, getRemoteVersion, getRemoteCommit } from '../lib/git-ops.mjs';
import { expandHome } from '../lib/paths.mjs';

function versionLabel(version, commit) {
  if (version) return version;
  if (commit) return `@${commit}`;
  return '—';
}

function statusLabel(pkg, behind, remoteVersion, remoteCommit, fetchOk) {
  if (pkg.source === 'local') return { label: chalk.gray('· local'), color: 'gray' };
  if (pkg.lockedVersion) return { label: chalk.yellow('🔒 locked'), color: 'yellow' };
  if (!fetchOk) return { label: chalk.gray('? fetch failed'), color: 'gray' };

  if (behind > 0) {
    const label = pkg.installedVersion && remoteVersion
      ? `⬆ ${remoteVersion}`
      : `⬆ ${behind} commit${behind !== 1 ? 's' : ''} behind`;
    return { label: chalk.yellow(label), color: 'yellow' };
  }

  return { label: chalk.green('✓ up to date'), color: 'green' };
}

export async function runStatus(options) {
  const registry = await readRegistry();
  const pkgs = Object.values(registry.packages || {});

  if (pkgs.length === 0) {
    console.log(chalk.yellow('\nNo packages in registry. Run `ocpkg init` first.\n'));
    return;
  }

  console.log(chalk.bold('\nOpenClaw Package Manager — Status\n'));

  const table = new Table({
    head: ['Package', 'Type', 'Installed', 'Remote', 'Status'].map(h => chalk.bold(h)),
    style: { head: [], border: [] },
    colWidths: [28, 8, 14, 14, 28],
  });

  let updateCount = 0;
  const now = new Date().toISOString();
  const updatedRegistry = { ...registry, packages: { ...registry.packages } };

  for (const pkg of pkgs) {
    const pkgPath = expandHome(pkg.path);

    let fetchOk = false;
    let behind = 0;
    let remoteVersion = null;
    let remoteCommit = null;

    if (pkg.source === 'github') {
      process.stdout.write(`  Checking ${pkg.name}...`);
      fetchOk = await fetchRemote(pkgPath, pkg.remoteName || 'origin');
      if (fetchOk) {
        const branch = pkg.branch || 'master';
        const remote = pkg.remoteName || 'origin';
        [behind, remoteVersion, remoteCommit] = await Promise.all([
          commitsBehind(pkgPath, remote, branch),
          getRemoteVersion(pkgPath, remote, branch),
          getRemoteCommit(pkgPath, remote, branch),
        ]);
      }
      process.stdout.write('\r' + ' '.repeat(40) + '\r');

      // Update lastChecked in registry
      updatedRegistry.packages[pkg.name] = {
        ...pkg,
        lastChecked: now,
      };
    }

    const { label } = statusLabel(pkg, behind, remoteVersion, remoteCommit, fetchOk);
    if (behind > 0) updateCount++;

    const installed = versionLabel(pkg.installedVersion, pkg.installedCommit);
    const remote = pkg.source === 'local' ? '—'
      : !fetchOk ? chalk.gray('?')
      : versionLabel(remoteVersion, remoteCommit);

    table.push([
      pkg.name,
      chalk.dim(pkg.type),
      installed,
      remote,
      label,
    ]);
  }

  console.log(table.toString());

  if (updateCount > 0) {
    console.log(chalk.yellow(`\n  ${updateCount} update${updateCount !== 1 ? 's' : ''} available.`) +
      ` Run ${chalk.cyan('ocpkg upgrade <name>')} to upgrade.\n`);
  } else {
    console.log(chalk.green('\n  All packages up to date.\n'));
  }

  // Save updated lastChecked
  await writeRegistry(updatedRegistry);
}
