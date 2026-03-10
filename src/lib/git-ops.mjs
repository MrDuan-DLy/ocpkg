import { simpleGit } from 'simple-git';

export function git(dir) {
  return simpleGit(dir, { timeout: { block: 30000 } });
}

/**
 * Fetch from remote. Returns true on success, false on failure.
 */
export async function fetchRemote(dir, remote = 'origin') {
  try {
    await git(dir).fetch([remote, '--quiet', '--tags']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current HEAD commit hash (short).
 */
export async function getHeadCommit(dir, short = true) {
  try {
    const log = await git(dir).log({ maxCount: 1 });
    const hash = log.latest?.hash || '';
    return short ? hash.slice(0, 7) : hash;
  } catch {
    return null;
  }
}

/**
 * Get the remote branch's latest commit hash (short).
 * Returns null if fetch failed or branch not found.
 */
export async function getRemoteCommit(dir, remote = 'origin', branch = 'master', short = true) {
  try {
    const g = git(dir);
    // Try the specified branch, then fall back to main
    let hash = null;
    for (const b of [branch, branch === 'master' ? 'main' : 'master']) {
      try {
        const result = await g.raw(['rev-parse', `${remote}/${b}`]);
        hash = result.trim();
        break;
      } catch {}
    }
    if (!hash) return null;
    return short ? hash.slice(0, 7) : hash;
  } catch {
    return null;
  }
}

/**
 * Get the remote branch name (master or main).
 */
export async function detectRemoteBranch(dir, remote = 'origin') {
  try {
    const g = git(dir);
    for (const branch of ['master', 'main']) {
      try {
        await g.raw(['rev-parse', `${remote}/${branch}`]);
        return branch;
      } catch {}
    }
    return 'master';
  } catch {
    return 'master';
  }
}

/**
 * Check how many commits behind HEAD is vs remote branch.
 */
export async function commitsBehind(dir, remote = 'origin', branch = 'master') {
  try {
    const g = git(dir);
    // Try both branch names
    for (const b of [branch, branch === 'master' ? 'main' : 'master']) {
      try {
        const result = await g.raw(['rev-list', '--count', `HEAD..${remote}/${b}`]);
        return parseInt(result.trim(), 10) || 0;
      } catch {}
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Get the version from remote's package.json (via git show).
 */
export async function getRemoteVersion(dir, remote = 'origin', branch = 'master') {
  try {
    const g = git(dir);
    for (const b of [branch, branch === 'master' ? 'main' : 'master']) {
      try {
        const raw = await g.raw(['show', `${remote}/${b}:package.json`]);
        const pkg = JSON.parse(raw);
        return pkg.version || null;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pull latest from remote.
 */
export async function pull(dir, remote = 'origin', branch = 'master') {
  const g = git(dir);
  await g.pull(remote, branch);
}

/**
 * Checkout a specific commit.
 */
export async function checkout(dir, ref) {
  await git(dir).checkout(ref);
}

/**
 * Get full commit hash for HEAD.
 */
export async function getHeadCommitFull(dir) {
  try {
    const result = await git(dir).raw(['rev-parse', 'HEAD']);
    return result.trim();
  } catch {
    return null;
  }
}
