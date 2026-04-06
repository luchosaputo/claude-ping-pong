# 🏓 claude-ping-pong 🏓

> Inline Markdown review with real-time two-way sync between your browser and your Claude agent.

You're iterating on a document with Claude. The draft looks almost right. You open the file, read through it, find three things to fix — and then you're back in the chat, manually describing which paragraph to change, copying text to give context, explaining what you meant. Again. And again.

**claude-ping-pong eliminates that loop.**

Open any Markdown file in a Google Docs-style review interface, leave inline comments on specific text fragments, and watch Claude pick them up automatically — no copy-pasting, no manual commands, no context lost in translation.

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   You (browser)          claude-ping-pong        Claude     │
│                                                              │
│   Select text  ──────►  Store comment  ──────►  Detects     │
│   Leave comment          (SQLite)               comment     │
│                                                              │
│   See update   ◄──────  SSE push      ◄──────  Edits file   │
│   in real-time           (chokidar)             Replies      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

1. Run `/ping-pong` on any Markdown file inside Claude Code — or just say *"I'll review this"*, *"let's iterate on the plan"*, *"open this for review"*
2. A local web server starts and returns a review URL
3. Open the URL — your document renders with full Markdown styling
4. Select any text fragment and leave a comment
5. Claude polls for new comments every 2 minutes, picks them up, responds or edits
6. If Claude modifies the file, your browser updates in real time
7. Reply to Claude's responses, resolve threads when done — repeat until the document is right

---

## Features

**Inline comments anchored to the document**
Select any text within a block and attach a comment. Comments float beside the document, Google Docs-style, aligned to the exact fragment you selected.
**Real-time sync in both directions**
- Browser → Claude: polling every 2 minutes via `/loop`, atomic acknowledge-on-read so no comment is processed twice
- Claude → browser: SSE push on file changes (chokidar) and thread state changes

**Thread history visible to both sides**
Every thread shows the full exchange: your comment, Claude's reply, your response. Both you and Claude have the same context.

**Works entirely offline**
All state lives in `~/.claude-ping-pong/db.sqlite`. No accounts, no cloud, no data leaves your machine.

---

## Installation

```bash
npm install -g claude-ping-pong
```

The Claude Code skill is installed automatically via the postinstall script.

---

## Usage

Inside a Claude Code session, run:

```
/ping-pong path/to/your/document.md
```

Claude will:
1. Register the file and start the local server (if not already running)
2. Print a review URL
3. Start polling for your comments automatically

Open the URL in your browser and start reviewing.

### CLI commands (for scripting or manual use)

```bash
claude-ping-pong open <file>              # Register file, return URL + file-id
claude-ping-pong comments <file-id>       # Get pending comments (JSON) + auto-acknowledge
claude-ping-pong reply <thread-id> "text" # Reply to a thread
claude-ping-pong resolve <thread-id>      # Close a thread
```

`comments`, `reply`, and `resolve` operate directly on SQLite — no web server needed.

---

## Stack

| Layer | Technology |
|---|---|
| Server | [Hono](https://hono.dev/) + Node.js |
| Frontend | Vite SPA (React 19 + TypeScript) |
| Database | SQLite via `better-sqlite3` |
| File watching | chokidar |
| Real-time sync | SSE (server → browser) |
| CLI | citty |

---

## Why not just describe the change in chat?

You could. But:

- You lose the rendered view — nobody wants to proofread a wall of raw `.md`
- You lose precise anchoring — "the third paragraph in the Introduction" is ambiguous after edits
- You lose thread history — every round-trip resets context


The browser gives you the document as a reader sees it. Comments carry the exact text fragment plus surrounding context. Claude always knows what you're talking about.

---

## License

MIT
