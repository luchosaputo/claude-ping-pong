#!/usr/bin/env node

import { defineCommand, runMain } from 'citty'

const main = defineCommand({
  meta: { description: 'Local Markdown review tool for Claude agents' },
  subCommands: {
    open: () => import('./commands/open.js').then((m) => m.default),
    comments: () => import('./commands/comments.js').then((m) => m.default),
    reply: () => import('./commands/reply.js').then((m) => m.default),
    resolve: () => import('./commands/resolve.js').then((m) => m.default),
  },
})

runMain(main)
