import chalk from 'chalk';
import Table from 'cli-table3';
import { readHistory } from '../lib/history.mjs';

export async function runHistory(name, options) {
  const entries = await readHistory(name || null);

  if (entries.length === 0) {
    if (name) {
      console.log(chalk.yellow(`\nNo history for "${name}".\n`));
    } else {
      console.log(chalk.yellow('\nNo upgrade history yet. Run `ocpkg upgrade <name>` to get started.\n'));
    }
    return;
  }

  const title = name ? `Upgrade History — ${name}` : 'Upgrade History';
  console.log(chalk.bold(`\nOpenClaw Package Manager — ${title}\n`));

  const table = new Table({
    head: ['Timestamp', 'Package', 'From', 'To', 'Status', 'Rollback?'].map(h => chalk.bold(h)),
    style: { head: [], border: [] },
    colWidths: [22, 25, 14, 14, 10, 10],
  });

  // Show newest first
  const sorted = [...entries].reverse();

  for (const e of sorted) {
    const ts = new Date(e.ts).toLocaleString('sv-SE').slice(0, 16);
    const status = e.status === 'success' ? chalk.green('success') : chalk.red(e.status || 'unknown');
    const rollback = e.rollback ? chalk.yellow('yes') : chalk.gray('no');

    table.push([ts, e.pkg || '—', e.from || '—', e.to || '—', status, rollback]);
  }

  console.log(table.toString());
  console.log(`  ${entries.length} record${entries.length !== 1 ? 's' : ''} total.\n`);
}
