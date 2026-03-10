import chalk from 'chalk';
import { scanAll } from '../lib/scanner.mjs';
import { readRegistry, writeRegistry } from '../lib/registry.mjs';
import { REGISTRY_PATH } from '../lib/paths.mjs';

export async function runInit(options) {
  console.log(chalk.bold('\nOpenClaw Package Manager — Init\n'));
  console.log('Scanning plugins and skills directories...\n');

  const found = await scanAll();

  if (found.length === 0) {
    console.log(chalk.yellow('No packages found in ~/.openclaw/workspace/'));
    return;
  }

  // Read existing registry to preserve locked versions and other manual settings
  const existing = await readRegistry();

  const packages = {};
  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const pkg of found) {
    const isNew = !existing.packages[pkg.name];
    const prev = existing.packages[pkg.name];

    if (pkg.source === 'local') {
      console.log(chalk.gray(`  ${pkg.name.padEnd(30)} [${pkg.type}] local — skipped (no git)`));
      skippedCount++;
    } else {
      const status = isNew ? chalk.green('new') : chalk.cyan('updated');
      console.log(
        `  ${pkg.name.padEnd(30)} [${pkg.type}] ${status} — ${pkg.remote || 'unknown remote'}`
      );
      if (isNew) newCount++; else updatedCount++;
    }

    packages[pkg.name] = {
      ...pkg,
      // Preserve locked version from existing registry
      lockedVersion: prev?.lockedVersion ?? null,
      lastChecked: prev?.lastChecked ?? null,
    };
  }

  const registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    packages,
  };

  await writeRegistry(registry);

  console.log(chalk.bold(`\nRegistry saved to ${REGISTRY_PATH}`));
  console.log(`  ${newCount} new, ${updatedCount} existing, ${skippedCount} local (skipped)`);
  console.log(chalk.gray('\nRun `ocpkg status` to check for updates.\n'));
}
