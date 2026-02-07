#!/bin/bash
set -e

echo "🦞 ClawRouter Reinstall"
echo ""

# 1. Remove plugin files
echo "→ Removing plugin files..."
rm -rf ~/.openclaw/extensions/clawrouter

# 2. Clean config entries
echo "→ Cleaning config entries..."
node -e "
const f = require('os').homedir() + '/.openclaw/openclaw.json';
const fs = require('fs');
if (fs.existsSync(f)) {
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (c.plugins?.entries?.clawrouter) delete c.plugins.entries.clawrouter;
  if (c.plugins?.installs?.clawrouter) delete c.plugins.installs.clawrouter;
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
}
"

# 3. Kill old proxy
echo "→ Stopping old proxy..."
lsof -ti :8402 | xargs kill -9 2>/dev/null || true

# 4. Reinstall
echo "→ Installing ClawRouter..."
openclaw plugins install @blockrun/clawrouter

echo ""
echo "✓ Done! Run: openclaw gateway restart"
