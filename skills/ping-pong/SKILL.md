---
name: ping-pong
description: Open a Markdown file in claude-ping-pong, show the review URL to the user, and start a 30-second polling loop for pending comments. Use when the user asks to review or iterate on a plan, document, doc, file, or Markdown in the browser, including phrases like "I am going to review your plan", "Let's iterate this plan", "Let's work on this document", "Voy a revisar tu plan", "Iteremos este documento", or "Trabajemos este archivo".
---

# Ping Pong

Run this skill when the user wants to review a Markdown file through `claude-ping-pong`.

## Workflow

1. Run `claude-ping-pong open <file>`.
2. Parse the JSON output to get `url` and `fileId`.
3. Show the `url` to the user directly.
4. Start `/loop 2m` with `claude-ping-pong comments <fileId>`.

## Output rules

- Do not summarize or reinterpret the `url`; surface it plainly so the user can open it immediately.
- Use the returned `fileId` exactly as emitted by `claude-ping-pong open`.
- If `open` fails, report the CLI error and do not start the loop.
- If the user did not specify a file, ask for one.

## Handling comments from the polling loop

When the loop fires and `claude-ping-pong comments <fileId>` returns a non-empty array, process each thread as follows.

### Classify the comment

Read the `body` of the last message in the thread and classify it into one of three categories:

| Category | Examples |
|----------|---------|
| **Actionable** | "cambia esto a …", "borra este párrafo", "agrega más detalle aquí", "replace X with Y", "remove this section" |
| **Ambiguous** | Vague feedback without a clear direction: "esto no me convence", "mejorar", "algo está mal acá" |
| **Opinion request** | User asks for options or input: "¿qué otras opciones hay?", "¿no hay otra forma de decir esto?", "suggest alternatives" |

**When in doubt, treat as Ambiguous — always prefer asking over modifying.**

### Actionable → edit and resolve

1. Apply the requested change directly to the file the session was opened with.
2. Run `claude-ping-pong resolve <threadId>` to mark the thread as resolved.
3. Do **not** reply to the thread after resolving; the edit itself is the response.

### Ambiguous → ask for clarification

1. Run `claude-ping-pong reply <threadId> "<question>"` asking what the user wants specifically.
2. Do **not** edit the file until the user clarifies.

### Opinion request → reply with options

1. Compose 2–4 concrete alternatives or suggestions based on the context of the highlighted fragment.
2. Run `claude-ping-pong reply <threadId> "<options>"` with the alternatives listed clearly.
3. Do **not** edit the file; wait for the user to pick an option (which will arrive as a new comment).

## CLI reference

```
claude-ping-pong open <file>          → { fileId, url }
claude-ping-pong comments <fileId>    → JSON array of comment threads
claude-ping-pong resolve <threadId>   → marks thread resolved
claude-ping-pong reply <threadId> <message> → posts a reply to the thread
```
