import { readdir, readFile, stat } from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import { join, dirname, parse } from 'path';
import { PLUGINS_DIR, SKILLS_DIR } from './paths.mjs';
import { simpleGit } from 'simple-git';

async function isDir(p) {
  try {
    const s = await stat(p); // stat follows symlinks
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function hasFile(dir, filename) {
  return existsSync(join(dir, filename));
}

async function hasDirectory(dir, dirname) {
  return existsSync(join(dir, dirname));
}

async function readPackageJson(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = await readFile(pkgPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function hasTsFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function getGitInfo(dir) {
  try {
    const git = simpleGit(dir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    // Get remotes
    const remotes = await git.getRemotes(true);
    const originRemote = remotes.find(r => r.name === 'origin');
    const upstreamRemote = remotes.find(r => r.name === 'upstream');
    const remote = originRemote || upstreamRemote || remotes[0];
    const remoteUrl = remote?.refs?.fetch || null;
    const remoteName = remote?.name || 'origin';

    // Get current branch
    let branch = 'master';
    try {
      const branchInfo = await git.branch();
      branch = branchInfo.current || 'master';
    } catch {}

    // Get current commit
    let commit = null;
    try {
      const log = await git.log({ maxCount: 1 });
      commit = log.latest?.hash?.slice(0, 7) || null;
    } catch {}

    return { remoteUrl, remoteName, branch, commit, isGit: true };
  } catch {
    return null;
  }
}

// Walk up from dir to find the nearest .git root (for symlinks into subdirs)
// Only returns a root if it has a remote AND the resolved dir is a direct child
// (prevents workspace/.git from claiming all subdirectories)
async function findGitRoot(dir) {
  const resolved = realpathSync(dir);
  // Only check the immediate parent — don't walk further up
  // This handles: symlink -> /project/skill/ where .git is at /project/
  const parent = dirname(resolved);
  if (await hasDirectory(parent, '.git')) {
    // Verify it has a real remote (not just the workspace repo)
    try {
      const sg = simpleGit(parent);
      const remotes = await sg.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      if (origin && origin.refs && origin.refs.fetch) {
        return parent;
      }
    } catch {}
  }
  return null;
}

async function scanDir(directory, type) {
  if (!existsSync(directory)) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.isSymbolicLink() && !await isDir(entryPath)) continue;
    const dir = join(directory, entry.name);
    const name = entry.name;

    let isGit = await hasDirectory(dir, '.git');
    let gitDir = dir;

    // If no .git in the directory itself AND it's a symlink, check if the
    // symlink target's parent is a git repo (e.g. symlink -> project/skill/)
    if (!isGit && entry.isSymbolicLink()) {
      const gitRoot = await findGitRoot(dir);
      if (gitRoot) {
        isGit = true;
        gitDir = gitRoot;
      }
    }

    if (!isGit) {
      results.push({
        name,
        type,
        source: 'local',
        path: dir,
        remote: null,
        remoteName: 'origin',
        branch: null,
        installedVersion: null,
        installedCommit: null,
        lockedVersion: null,
        lastChecked: null,
        hasNodeModules: false,
        requiresJitiClear: false,
        requiresRestart: type === 'plugin',
        tags: [],
      });
      continue;
    }

    const gitInfo = await getGitInfo(gitDir);
    const pkgJson = await readPackageJson(gitDir);
    const tsFiles = await hasTsFiles(dir);
    const hasDepsInPkg = pkgJson && (
      Object.keys(pkgJson.dependencies || {}).length > 0 ||
      Object.keys(pkgJson.devDependencies || {}).length > 0
    );

    results.push({
      name,
      type,
      source: 'github',
      path: dir,
      remote: gitInfo?.remoteUrl || null,
      remoteName: gitInfo?.remoteName || 'origin',
      branch: gitInfo?.branch || 'master',
      installedVersion: pkgJson?.version || null,
      installedCommit: gitInfo?.commit || null,
      lockedVersion: null,
      lastChecked: null,
      hasNodeModules: !!hasDepsInPkg,
      requiresJitiClear: tsFiles,
      requiresRestart: type === 'plugin',
      tags: [],
    });
  }

  return results;
}

export async function scanAll() {
  const [plugins, skills] = await Promise.all([
    scanDir(PLUGINS_DIR, 'plugin'),
    scanDir(SKILLS_DIR, 'skill'),
  ]);
  return [...plugins, ...skills];
}
