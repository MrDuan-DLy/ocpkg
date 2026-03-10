import chalk from 'chalk';
import { readRegistry } from '../lib/registry.mjs';
import { fetchRemote, git, detectRemoteBranch } from '../lib/git-ops.mjs';
import { expandHome } from '../lib/paths.mjs';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { execSync } from 'child_process';

// ─── Git diff helpers ─────────────────────────────────────────────────────────

async function resolveRemoteBranch(g, remote, preferredBranch) {
  for (const b of [preferredBranch, preferredBranch === 'master' ? 'main' : 'master']) {
    try {
      await g.raw(['rev-parse', `${remote}/${b}`]);
      return b;
    } catch {}
  }
  return preferredBranch;
}

async function getDiffData(pkgPath, remote, preferredBranch) {
  const g = git(pkgPath);
  const branch = await resolveRemoteBranch(g, remote, preferredBranch);
  const ref = `HEAD..${remote}/${branch}`;

  // Commits
  let commits = [];
  try {
    const logRaw = await g.raw(['log', ref, '--oneline']);
    commits = logRaw.trim() ? logRaw.trim().split('\n') : [];
  } catch {}

  // Numstat (added/removed lines per file)
  let totalAdded = 0, totalRemoved = 0, filesChanged = 0;
  try {
    const numstatRaw = await g.raw(['diff', ref, '--numstat']);
    if (numstatRaw.trim()) {
      for (const line of numstatRaw.trim().split('\n')) {
        const [addedStr, removedStr] = line.split('\t');
        const added = parseInt(addedStr, 10);
        const removed = parseInt(removedStr, 10);
        if (!isNaN(added)) totalAdded += added;
        if (!isNaN(removed)) totalRemoved += removed;
        filesChanged++;
      }
    }
  } catch {}

  // Dep changes (package.json diff)
  let depChanges = { added: [], removed: [], updated: [] };
  try {
    const pkgDiff = await g.raw(['diff', ref, '--', 'package.json']);
    if (pkgDiff.trim()) depChanges = parseDepChanges(pkgDiff);
  } catch {}

  // Plugin schema changed
  let pluginSchemaChanged = false;
  try {
    const pluginDiff = await g.raw(['diff', ref, '--', 'openclaw.plugin.json']);
    pluginSchemaChanged = !!pluginDiff.trim();
  } catch {}

  // Remote version
  let remoteVersion = null;
  try {
    const pkgJson = await g.raw(['show', `${remote}/${branch}:package.json`]);
    remoteVersion = JSON.parse(pkgJson).version || null;
  } catch {}

  return { commits, filesChanged, totalAdded, totalRemoved, depChanges, pluginSchemaChanged, remoteVersion, branch };
}

function parseDepChanges(diff) {
  const added = [];
  const removed = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const sign = line[0];
    if (sign !== '+' && sign !== '-') continue;
    const match = line.slice(1).match(/"(@?[\w/.-]+)":\s*"([^"]+)"/);
    if (!match) continue;
    const [, pkg, ver] = match;
    if (sign === '+') added.push({ pkg, ver });
    else removed.push({ pkg, ver });
  }
  const result = { added: [], removed: [], updated: [] };
  for (const a of added) {
    const r = removed.find(r => r.pkg === a.pkg);
    if (r) result.updated.push({ pkg: a.pkg, from: r.ver, to: a.ver });
    else result.added.push(a);
  }
  for (const r of removed) {
    if (!added.find(a => a.pkg === r.pkg)) result.removed.push(r);
  }
  return result;
}

// ─── Risk assessment ──────────────────────────────────────────────────────────

function isPrerelease(version) {
  return !!version && /alpha|beta|rc|pre|canary|nightly/i.test(version);
}

function versionParts(v) {
  if (!v) return [0, 0, 0];
  const clean = v.replace(/[^0-9.]/g, '');
  return clean.split('.').map(Number);
}

function assessRisk(data, localVersion, remoteVersion) {
  let riskScore = 0;
  const reasons = [];
  const keyChanges = [];

  if (isPrerelease(remoteVersion)) {
    riskScore += 2;
    keyChanges.push('! pre-release (beta/alpha)');
  }

  if (localVersion && remoteVersion) {
    const [lMaj, lMin] = versionParts(localVersion);
    const [rMaj, rMin] = versionParts(remoteVersion);
    if (rMaj > lMaj) {
      riskScore += 4;
    } else if (rMin > lMin) {
      riskScore += 1;
    }
  }

  const totalLines = data.totalAdded + data.totalRemoved;
  if (totalLines > 1000) riskScore += 3;
  else if (totalLines > 100) riskScore += 1;

  const totalDepChanges = data.depChanges.added.length + data.depChanges.removed.length + data.depChanges.updated.length;
  if (totalDepChanges > 3) riskScore += 2;
  else if (totalDepChanges > 0) riskScore += 1;

  if (data.pluginSchemaChanged) {
    riskScore += 2;
    keyChanges.push('! plugin schema changed');
  }

  // Extract interesting commit messages (feat/fix/break)
  for (const c of data.commits.slice(0, 8)) {
    const msg = c.replace(/^[a-f0-9]+\s+/, '');
    if (/^feat|^fix|^break|BREAKING/i.test(msg)) {
      const prefix = /^feat/i.test(msg) ? '+' : /^fix/i.test(msg) ? '+' : '!';
      keyChanges.push(`${prefix} ${msg}`);
    }
  }

  let risk, suggestion;
  if (riskScore >= 5) {
    risk = 'HIGH';
    suggestion = 'Test on non-production instance first. Consider waiting for a stable release.';
  } else if (riskScore >= 2) {
    risk = 'MEDIUM';
    suggestion = 'Test on non-production instance first.';
  } else {
    risk = 'LOW';
    suggestion = 'Generally safe to upgrade.';
  }

  // Build human-readable reason
  const parts = [];
  if (isPrerelease(remoteVersion)) parts.push('Pre-release version.');
  if ((data.totalAdded + data.totalRemoved) > 1000) parts.push(`${(data.totalAdded + data.totalRemoved).toLocaleString()}+ lines changed.`);
  if (totalDepChanges > 0) parts.push(`${totalDepChanges} dependency change${totalDepChanges !== 1 ? 's' : ''}.`);
  if (data.pluginSchemaChanged) parts.push('Plugin schema updated.');
  const reason = parts.length > 0 ? parts.join(' ') : (riskScore === 0 ? 'Small, targeted change.' : 'Moderate changes.');

  return { risk, riskScore, reasons, keyChanges, reason, suggestion };
}

// ─── AI evaluation ────────────────────────────────────────────────────────────

const CLAUDE_BIN = (() => {
  if (process.env.CLAUDE_CODE_BIN) return process.env.CLAUDE_CODE_BIN;
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim();
  } catch {
    const home = process.env.HOME || '/root';
    const candidates = [
      home + '/.local/bin/claude',
      '/usr/local/bin/claude',
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return null;
  }
})();

async function aiEvaluate(name, localVersion, data, assessment) {
  if (!existsSync(CLAUDE_BIN)) {
    console.log(chalk.gray('\n  [--ai] claude CLI not found at ' + CLAUDE_BIN + '. Skipping AI analysis.\n'));
    return;
  }

  const prompt = `You are evaluating a package upgrade for the OpenClaw system.

Package: ${name}
Current version: ${localVersion || 'unknown'}
Remote version: ${data.remoteVersion || 'unknown'}
Commits: ${data.commits.length} new commits
Files changed: ${data.filesChanged}
Lines added: ${data.totalAdded}, removed: ${data.totalRemoved}
New dependencies: ${data.depChanges.added.map(d => d.pkg).join(', ') || 'none'}
Removed dependencies: ${data.depChanges.removed.map(d => d.pkg).join(', ') || 'none'}
Plugin schema changed: ${data.pluginSchemaChanged}

Sample commits:
${data.commits.slice(0, 10).join('\n')}

Rule-based risk: ${assessment.risk}

In 2-3 sentences, assess the risk of this upgrade. Be concise and direct. Focus on any breaking changes or stability concerns.`;

  console.log(chalk.bold('\n  AI Analysis:'));

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ['--model', 'claude-haiku-4-5-20251001', '-p'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', () => {});

    child.on('close', () => {
      if (output.trim()) {
        for (const line of output.trim().split('\n')) {
          console.log(chalk.italic('  ' + line));
        }
      } else {
        console.log(chalk.gray('  (no AI response)'));
      }
      resolve();
    });

    child.on('error', () => {
      console.log(chalk.gray('  (AI evaluation failed)'));
      resolve();
    });

    // Timeout
    setTimeout(() => {
      child.kill();
      resolve();
    }, 30000);
  });
}

// ─── Deep: GitHub issues ──────────────────────────────────────────────────────

function parseGitHubRepo(remoteUrl) {
  if (!remoteUrl) return null;
  // https://github.com/owner/repo.git or git@github.com:owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return null;
}

async function fetchGitHubIssues(remoteUrl) {
  const repo = parseGitHubRepo(remoteUrl);
  if (!repo) {
    console.log(chalk.gray('\n  [--deep] Cannot determine GitHub repo from remote URL.'));
    return;
  }

  try {
    const output = execSync(
      `gh issue list --repo ${repo} --state open --label bug --limit 10 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    );
    console.log(chalk.bold('\n  Open Bug Issues:'));
    if (!output.trim()) {
      console.log(chalk.green('  No open bug issues found.'));
    } else {
      for (const line of output.trim().split('\n')) {
        console.log('  ' + chalk.gray(line));
      }
    }
  } catch {
    console.log(chalk.gray('\n  [--deep] gh CLI not available or failed. Skipping issue fetch.'));
  }
}

// ─── Output formatters ────────────────────────────────────────────────────────

function printCheckResult(pkg, data, assessment) {
  const localVersion = pkg.installedVersion || `@${pkg.installedCommit}`;
  const remoteVersion = data.remoteVersion || '?';
  const depChangeSummary = [
    data.depChanges.added.length > 0 && `${data.depChanges.added.length} added`,
    data.depChanges.removed.length > 0 && `${data.depChanges.removed.length} removed`,
    data.depChanges.updated.length > 0 && `${data.depChanges.updated.length} updated`,
  ].filter(Boolean).join(', ') || 'none';

  console.log(chalk.bold(`\n${pkg.name}: ${localVersion} → ${remoteVersion}\n`));
  console.log(`  Commits: ${chalk.cyan(data.commits.length)} new`);
  console.log(`  Files:   ${chalk.cyan(data.filesChanged)} changed (${chalk.green('+' + data.totalAdded.toLocaleString())} / ${chalk.red('-' + data.totalRemoved.toLocaleString())})`);
  console.log(`  Deps:    ${chalk.cyan(depChangeSummary)}`);

  if (data.keyChanges && data.keyChanges.length > 0) {
    console.log('\n  Key changes:');
    for (const kc of data.keyChanges.slice(0, 6)) {
      const color = kc.startsWith('!') ? chalk.red : kc.startsWith('+') ? chalk.green : chalk.yellow;
      console.log('    ' + color(kc));
    }
  }

  const riskColor = assessment.risk === 'HIGH' ? chalk.red.bold
    : assessment.risk === 'MEDIUM' ? chalk.yellow.bold
    : chalk.green.bold;

  console.log(`\n  Risk:       ${riskColor(assessment.risk)}`);
  console.log(`  Reason:     ${assessment.reason}`);
  console.log(`  Suggestion: ${chalk.italic(assessment.suggestion)}`);
}

// ─── Check all (JSON mode) ───────────────────────────────────────────────────

async function runCheckAll(options) {
  const registry = await readRegistry();
  const pkgs = Object.values(registry.packages || {}).filter(p => p.source === 'github');

  if (pkgs.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), updates: [], upToDate: 0, locked: 0 }));
    } else {
      console.log(chalk.yellow('\nNo GitHub packages in registry. Run `ocpkg init` first.\n'));
    }
    return;
  }

  if (!options.json) {
    console.log(chalk.bold('\nChecking all packages...\n'));
  }

  const updates = [];
  let upToDate = 0;
  let locked = 0;

  for (const pkg of pkgs) {
    if (pkg.lockedVersion) {
      locked++;
      continue;
    }

    if (!options.json) process.stdout.write(`  Checking ${pkg.name}...`);

    const pkgPath = expandHome(pkg.gitRoot || pkg.path);
    const remote = pkg.remoteName || 'origin';
    const branch = pkg.branch || 'master';

    const fetched = await fetchRemote(pkgPath, remote);
    if (!fetched) {
      if (!options.json) console.log(chalk.gray(' fetch failed'));
      continue;
    }

    const data = await getDiffData(pkgPath, remote, branch);

    if (!options.json) {
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
    }

    if (data.commits.length === 0) {
      upToDate++;
      continue;
    }

    const assessment = assessRisk(data, pkg.installedVersion, data.remoteVersion);

    if (options.json) {
      updates.push({
        name: pkg.name,
        type: pkg.type,
        current: pkg.installedVersion || pkg.installedCommit,
        available: data.remoteVersion || null,
        commits: data.commits.length,
        filesChanged: data.filesChanged,
        linesAdded: data.totalAdded,
        linesRemoved: data.totalRemoved,
        risk: assessment.risk.toLowerCase(),
        prerelease: isPrerelease(data.remoteVersion),
        pluginSchemaChanged: data.pluginSchemaChanged,
        depChanges: {
          added: data.depChanges.added.length,
          removed: data.depChanges.removed.length,
          updated: data.depChanges.updated.length,
        },
      });
    } else {
      printCheckResult(pkg, data, assessment);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      updates,
      upToDate,
      locked,
    }, null, 2));
  } else if (updates.length === 0) {
    console.log(chalk.green('\n  All packages up to date.\n'));
  } else {
    console.log();
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runCheck(name, options) {
  if (options.all) {
    return runCheckAll(options);
  }

  if (!name) {
    console.error(chalk.red('\nUsage: ocpkg check <name> [--ai] [--deep]\n       ocpkg check --all [--json]\n'));
    process.exit(1);
  }

  const registry = await readRegistry();
  const pkg = registry.packages[name];

  if (!pkg) {
    console.error(chalk.red(`\nPackage "${name}" not found in registry. Run \`ocpkg init\` first.\n`));
    process.exit(1);
  }

  if (pkg.source === 'local') {
    console.error(chalk.yellow(`\nPackage "${name}" is a local package with no remote. Nothing to check.\n`));
    process.exit(1);
  }

  const pkgPath = expandHome(pkg.gitRoot || pkg.path);
  const remote = pkg.remoteName || 'origin';
  const branch = pkg.branch || 'master';

  console.log(chalk.bold(`\nChecking ${name}...`));

  process.stdout.write('  Fetching remote...');
  const fetched = await fetchRemote(pkgPath, remote);
  process.stdout.write('\r' + ' '.repeat(30) + '\r');

  if (!fetched) {
    console.error(chalk.red(`  Failed to fetch from remote. Check network or remote URL.\n`));
    process.exit(1);
  }

  const data = await getDiffData(pkgPath, remote, branch);

  if (data.commits.length === 0) {
    console.log(chalk.green(`\n  ${name} is up to date.\n`));
    return;
  }

  const assessment = assessRisk(data, pkg.installedVersion, data.remoteVersion);
  printCheckResult(pkg, data, assessment);

  if (options.ai) {
    await aiEvaluate(name, pkg.installedVersion, data, assessment);
  }

  if (options.deep) {
    await fetchGitHubIssues(pkg.remote);
  }

  console.log();
}
