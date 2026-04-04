#!/usr/bin/env node

const [, , command, ...args] = process.argv

if (!command) {
  console.error('Usage: claude-ping-pong <command> [args]')
  console.error('Commands: open, comments, reply, resolve')
  process.exit(1)
}

console.log(`Command: ${command}`, args)
