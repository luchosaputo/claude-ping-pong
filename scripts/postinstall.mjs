#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const claudeDir = join(homedir(), '.claude');

// ── Install skill ──────────────────────────────────────────────────────────

const skillSrc = join(__dirname, '..', 'skills', 'ping-pong', 'SKILL.md');
const skillDestDir = join(claudeDir, 'skills', 'ping-pong');
const skillDest = join(skillDestDir, 'SKILL.md');

try {
  if (!existsSync(join(claudeDir, 'skills'))) {
    // ~/.claude/skills doesn't exist — Claude Code may not be installed
    console.log('claude-ping-pong: ~/.claude/skills not found. Install Claude Code first, then run:');
    console.log(`  mkdir -p "${skillDestDir}" && cp "${skillSrc}" "${skillDest}"`);
    process.exit(0);
  }

  mkdirSync(skillDestDir, { recursive: true });
  copyFileSync(skillSrc, skillDest);
  console.log('claude-ping-pong: skill installed → ~/.claude/skills/ping-pong/SKILL.md');
} catch (err) {
  console.warn('claude-ping-pong: could not install skill automatically.');
  console.warn(`  Copy manually: cp "${skillSrc}" "${skillDest}"`);
  console.warn(`  Error: ${err.message}`);
  // Non-zero exit would fail the npm install — we avoid that intentionally
}

// ── Allow claude-ping-pong CLI in ~/.claude/settings.json ─────────────────
// Edit/Write are NOT granted globally — they are added per-project by
// `claude-ping-pong open`, scoped to .claude/settings.local.json.

const settingsPath = join(claudeDir, 'settings.json');

try {
  let settings = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  }

  settings.permissions ??= {};
  settings.permissions.allow ??= [];

  const entry = 'Bash(claude-ping-pong:*)';
  if (!settings.permissions.allow.includes(entry)) {
    settings.permissions.allow.push(entry);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`claude-ping-pong: added ${entry} to ~/.claude/settings.json`);
  } else {
    console.log('claude-ping-pong: CLI permission already configured');
  }
} catch (err) {
  console.warn('claude-ping-pong: could not update ~/.claude/settings.json');
  console.warn(`  Add "Bash(claude-ping-pong:*)" to permissions.allow manually.`);
  console.warn(`  Error: ${err.message}`);
}
