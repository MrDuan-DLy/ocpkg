import { Command } from 'commander';
import { runInit } from './commands/init.mjs';
import { runStatus } from './commands/status.mjs';
import { runUpgrade } from './commands/upgrade.mjs';
import { runRollback } from './commands/rollback.mjs';
import { runHistory } from './commands/history.mjs';
import { runCheck } from './commands/check.mjs';
import { runLock, runUnlock } from './commands/lock.mjs';

const program = new Command();

program
  .name('ocpkg')
  .description('OpenClaw Package Manager — manage plugins and skills installed from GitHub')
  .version('1.1.0');

program
  .command('init')
  .description('Scan plugins/skills directories and generate registry.json')
  .action(async (options) => {
    await runInit(options);
  });

program
  .command('status')
  .description('Show installed packages and check for available updates')
  .action(async (options) => {
    await runStatus(options);
  });

program
  .command('check [name]')
  .description('Evaluate an update before upgrading — shows diff stats and risk assessment')
  .option('--ai', 'Get AI-powered analysis via claude CLI')
  .option('--deep', 'Also fetch open GitHub bug issues')
  .option('--all', 'Check all packages with available updates')
  .option('--json', 'Output in JSON format (use with --all)')
  .action(async (name, options) => {
    await runCheck(name, options);
  });

program
  .command('upgrade <name>')
  .description('Upgrade a package (backup → git pull → npm install → validate → restart)')
  .option('--force', 'Upgrade even if package is locked')
  .option('--no-restart', 'Skip gateway restart after upgrade')
  .action(async (name, options) => {
    await runUpgrade(name, options);
  });

program
  .command('rollback <name>')
  .description('Roll back a package to its previous backup state')
  .action(async (name, options) => {
    await runRollback(name, options);
  });

program
  .command('lock <name>')
  .description('Lock a package at its current version to prevent upgrades')
  .option('--reason <reason>', 'Reason for locking')
  .action(async (name, options) => {
    await runLock(name, options);
  });

program
  .command('unlock <name>')
  .description('Remove a version lock from a package')
  .action(async (name) => {
    await runUnlock(name);
  });

program
  .command('history [name]')
  .description('Show upgrade history, optionally filtered by package name')
  .action(async (name, options) => {
    await runHistory(name, options);
  });

export { program };
