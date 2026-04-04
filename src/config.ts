import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'

export const PORT = Number(process.env.CLAUDE_REVIEW_PORT ?? 3737)

export const DATA_DIR = join(homedir(), '.claude-ping-pong')

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true })
}
