---
name: ocpkg
description: >
  OpenClaw Package Manager. Check for updates, upgrade, and rollback
  plugins and skills installed from GitHub. Use when the user asks about
  updates, wants to upgrade packages, or needs to rollback a failed upgrade.
---

# ocpkg — OpenClaw Package Manager

Like apt update/upgrade for OpenClaw plugins and skills.

## Quick Reference

### Check for updates
```bash
ocpkg status
```

### Evaluate an update before upgrading
```bash
ocpkg check <name>        # Rule-based risk assessment
ocpkg check <name> --ai   # AI-powered analysis
ocpkg check <name> --deep # Also shows open GitHub bug issues
```

### Upgrade
```bash
ocpkg upgrade <name>              # Upgrade with backup + validation
ocpkg upgrade <name> --no-restart # Skip gateway restart
```

### Rollback
```bash
ocpkg rollback <name>
```

### Lock/Unlock
```bash
ocpkg lock <name> --reason "waiting for stable release"
ocpkg unlock <name>
```

### Automation / Cron
```bash
ocpkg check --all --json   # Machine-readable update report
```

### History
```bash
ocpkg history [name]
```

## Usage Guidelines

- Always run `ocpkg check <name>` before upgrading to assess risk
- For pre-release/beta versions, suggest testing on VPS first
- For plugins (requiresRestart=true), warn the user that gateway will restart
- Never auto-upgrade without user confirmation
- If upgrade fails, ocpkg auto-rollbacks; report the error to the user
- Locked packages (🔒) cannot be upgraded without `--force`
- Use `ocpkg check --all --json` in cron jobs to detect updates automatically
