# ocpkg Command Reference

## ocpkg init

Scan plugins and skills directories and generate/update `registry.json`.

Run this after installing a new plugin or skill from GitHub.

```bash
ocpkg init
```

---

## ocpkg status

Show all registered packages with their installed vs remote versions.

```bash
ocpkg status
```

Output columns: Package, Type, Installed version, Remote version, Status

Status indicators:
- `✓ up to date` — no updates available
- `⬆ <version>` — update available
- `🔒 locked` — package is version-locked
- `· local` — local package, no git remote
- `? fetch failed` — could not reach remote

---

## ocpkg check [name] [--ai] [--deep] [--all] [--json]

Evaluate a pending update before committing to it. Shows commit count, lines changed, dependency changes, and a risk score.

```bash
# Single package evaluation
ocpkg check <name>

# With AI analysis (uses claude CLI)
ocpkg check <name> --ai

# With open GitHub bug issues
ocpkg check <name> --deep

# All packages, human-readable
ocpkg check --all

# All packages, JSON output (for cron/automation)
ocpkg check --all --json
```

**Risk levels:**
- `LOW` — patch bump, <100 lines, no dep changes
- `MEDIUM` — minor bump, 100–1000 lines, some dep changes, or pre-release
- `HIGH` — major bump, >1000 lines, breaking dep changes, or plugin schema changed

**JSON output format (`--all --json`):**
```json
{
  "timestamp": "2026-03-10T21:00:00Z",
  "updates": [
    {
      "name": "memory-lancedb-pro",
      "type": "plugin",
      "current": "1.0.32",
      "available": "1.1.0-beta.5",
      "commits": 47,
      "filesChanged": 60,
      "linesAdded": 15338,
      "linesRemoved": 1292,
      "risk": "medium",
      "prerelease": true,
      "pluginSchemaChanged": false,
      "depChanges": { "added": 2, "removed": 0, "updated": 1 }
    }
  ],
  "upToDate": 3,
  "locked": 0
}
```

---

## ocpkg upgrade <name> [--force] [--no-restart]

Upgrade a package with automatic backup and rollback on failure.

```bash
ocpkg upgrade memory-lancedb-pro
ocpkg upgrade memory-lancedb-pro --no-restart
ocpkg upgrade memory-lancedb-pro --force    # bypass lock
```

**Steps performed:**
1. Pre-flight: fetch remote
2. Backup current state (tarball + manifest)
3. Git pull
4. npm install (if node_modules present)
5. Validate config (plugins only)
6. Clear jiti cache (TypeScript plugins)
7. Restart OpenClaw gateway (plugins, unless `--no-restart`)

If any step fails, automatically rolls back to the backup.

---

## ocpkg rollback <name>

Restore a package to its last backup state.

```bash
ocpkg rollback memory-lancedb-pro
```

Finds the most recent backup and restores it via `git checkout`.

---

## ocpkg lock <name> [--reason "..."]

Lock a package at its current version. Locked packages cannot be upgraded without `--force`.

```bash
ocpkg lock memory-lancedb-pro --reason "waiting for stable release"
```

The lock is stored in `registry.json` as `lockedVersion` and `lockReason`. Visible in `ocpkg status` as 🔒.

---

## ocpkg unlock <name>

Remove the version lock from a package.

```bash
ocpkg unlock memory-lancedb-pro
```

---

## ocpkg history [name]

Show upgrade and rollback history, newest first.

```bash
ocpkg history               # all packages
ocpkg history memory-lancedb-pro  # filtered
```

---

## File Locations

| Item | Path |
|------|------|
| Registry | `~/.openclaw/ocpkg/registry.json` |
| History | `~/.openclaw/ocpkg/history.jsonl` |
| Backups | `~/.openclaw/ocpkg/backups/<name>/<timestamp>/` |
| Plugins | `~/.openclaw/workspace/plugins/` |
| Skills | `~/.openclaw/workspace/skills/` |
