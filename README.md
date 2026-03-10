# ocpkg — OpenClaw Package Manager

Like `apt update/upgrade` for your OpenClaw plugins and skills.

Manage plugins and skills installed from GitHub with version checking, risk assessment, safe upgrades with automatic rollback, and upgrade history.

## Features

- **`ocpkg status`** — Check all packages for available updates
- **`ocpkg check <name>`** — Evaluate an update with risk assessment before upgrading
- **`ocpkg upgrade <name>`** — Backup → pull → validate → restart, with automatic rollback on failure
- **`ocpkg rollback <name>`** — Revert to previous version from backup
- **`ocpkg lock/unlock <name>`** — Pin a package to its current version
- **`ocpkg history`** — View upgrade and rollback history

## Install

```bash
# Clone
git clone https://github.com/seanduan/ocpkg.git
cd ocpkg
npm install

# Link globally
npm link

# Initialize (scans your plugins/skills directories)
ocpkg init
```

## Quick Start

```bash
# See what's installed and what has updates
ocpkg status

# Evaluate an update before committing
ocpkg check memory-lancedb-pro

# Upgrade with safety net (auto-rollback on failure)
ocpkg upgrade memory-lancedb-pro

# Something broke? Roll back
ocpkg rollback memory-lancedb-pro
```

## Commands

### `ocpkg init`

Scans `~/.openclaw/workspace/plugins/` and `~/.openclaw/workspace/skills/` for git-managed packages and creates a registry.

```
$ ocpkg init

OpenClaw Package Manager — Init

Scanning plugins and skills directories...

  a2a-gateway              [plugin] updated — https://github.com/...
  memory-lancedb-pro       [plugin] updated — https://github.com/...
  codex-deep-search        [skill] local — skipped (no git)

Registry saved. Run `ocpkg status` to check for updates.
```

### `ocpkg status`

Shows installed version vs. remote version for all tracked packages.

```
$ ocpkg status

 Package               Type    Installed   Remote       Status
 ──────────────────────────────────────────────────────────────
 memory-lancedb-pro    plugin  1.0.32      1.1.0-β5     ⬆ update available
 a2a-gateway           plugin  1.0.0       1.0.0        ✓ up to date
 my-skill              skill   @abc1234    @abc1234     ✓ up to date
```

### `ocpkg check <name> [--ai] [--deep] [--all] [--json]`

Evaluates a pending update with risk assessment.

```
$ ocpkg check memory-lancedb-pro

memory-lancedb-pro: 1.0.32 → 1.1.0-beta.5

  Commits: 89 new
  Files:   60 changed (+15,338 / -1,292)
  Deps:    3 updated

  Risk:       HIGH
  Reason:     Pre-release version. 16,630+ lines changed.
  Suggestion: Test on non-production instance first.
```

Options:
- `--ai` — Use Claude CLI for AI-powered risk analysis (requires `claude` in PATH or `CLAUDE_CODE_BIN` env var)
- `--deep` — Also check GitHub Issues for open bugs (requires `gh` CLI)
- `--all` — Check all packages at once
- `--json` — Output machine-readable JSON (useful for cron automation)

### `ocpkg upgrade <name> [--force] [--no-restart]`

Safely upgrades a package with automatic rollback on failure.

**Upgrade flow:**
1. Pre-flight checks (exists, not locked)
2. Backup current state (git ref + tarball)
3. `git pull` latest
4. `npm install` (if package has dependencies)
5. `openclaw config validate` (for plugins)
6. Clear jiti cache (for TypeScript plugins)
7. `openclaw gateway restart` (for plugins)
8. Post-verification
9. **Auto-rollback if any step fails**

Options:
- `--force` — Upgrade even if locked
- `--no-restart` — Skip gateway restart

### `ocpkg rollback <name>`

Restores a package to its previous version using the backup created during upgrade.

```
$ ocpkg rollback memory-lancedb-pro

Rolling back memory-lancedb-pro...
  Current: 1.1.0-beta.5 @ aa0ec8d
  Target:  1.0.32 @ eeb58e7

  ✓ Rolled back to 1.0.32
```

### `ocpkg lock <name> [--reason "..."]` / `ocpkg unlock <name>`

Pin a package to prevent accidental upgrades.

```
$ ocpkg lock memory-lancedb-pro --reason "waiting for stable release"
🔒 Locked memory-lancedb-pro at 1.0.32

$ ocpkg status
  memory-lancedb-pro  plugin  1.0.32  1.1.0-β5  🔒 locked

$ ocpkg unlock memory-lancedb-pro
🔓 Unlocked memory-lancedb-pro
```

### `ocpkg history [name]`

View upgrade and rollback history.

```
$ ocpkg history

 Timestamp            Package         From       To         Status   Rollback?
 ────────────────────────────────────────────────────────────────────────────
 2026-03-10 21:03     openclaw        @547ba65   @b314def   success  yes
 2026-03-10 21:02     openclaw        @b314def   @547ba65   success  no
```

## OpenClaw Skill Integration

Copy or symlink the `skill/` directory into your OpenClaw workspace:

```bash
ln -s /path/to/ocpkg/skill ~/.openclaw/workspace/skills/ocpkg
```

Your OpenClaw agent will then be able to use ocpkg commands when you ask about package updates.

## File Locations

| File | Purpose |
|------|---------|
| `~/.openclaw/ocpkg/registry.json` | Package registry (installed packages + metadata) |
| `~/.openclaw/ocpkg/history.jsonl` | Upgrade/rollback history log |
| `~/.openclaw/ocpkg/backups/<name>/` | Backup tarballs and manifests |

## How It Works

ocpkg tracks git-cloned OpenClaw plugins and skills. It uses `git fetch` to check for upstream changes, analyzes diffs to assess risk, and provides safe upgrade/rollback workflows.

**What it manages:**
- Plugins in `~/.openclaw/workspace/plugins/` (git repos)
- Skills in `~/.openclaw/workspace/skills/` (git repos or symlinks to git repos)

**What it doesn't manage:**
- Skills installed via [ClawHub](https://clawhub.com) (use `clawhub update` for those)
- Local-only skills without git remotes

## Requirements

- Node.js ≥ 18
- Git
- OpenClaw (for plugin validation and gateway restart)
- Optional: `claude` CLI (for `--ai` evaluation)
- Optional: `gh` CLI (for `--deep` GitHub Issues check)

## License

MIT
