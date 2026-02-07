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

# 5. Inject auth profile (ensures blockrun provider is recognized)
echo "→ Injecting auth profile..."
node -e "
const os = require('os');
const fs = require('fs');
const path = require('path');
const authDir = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent');
const authPath = path.join(authDir, 'auth-profiles.json');

// Create directory if needed
fs.mkdirSync(authDir, { recursive: true });

// Load or create auth-profiles.json
let authProfiles = {};
if (fs.existsSync(authPath)) {
  try { authProfiles = JSON.parse(fs.readFileSync(authPath, 'utf8')); } catch {}
}

// Inject blockrun auth if missing
if (!authProfiles.blockrun) {
  authProfiles.blockrun = {
    profileId: 'default',
    credential: { apiKey: 'x402-proxy-handles-auth' }
  };
  fs.writeFileSync(authPath, JSON.stringify(authProfiles, null, 2));
  console.log('  Auth profile created');
} else {
  console.log('  Auth profile already exists');
}
"

echo ""
echo "✓ Done! Run: openclaw gateway restart"
