import Database from 'better-sqlite3'
import { join } from 'path'
import { DATA_DIR, ensureDataDir } from './config.js'

function createDb(): Database.Database {
  ensureDataDir()
  const db = new Database(join(DATA_DIR, 'db.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      path          TEXT NOT NULL UNIQUE,
      registered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id                TEXT PRIMARY KEY,
      file_id           TEXT NOT NULL REFERENCES files(id),
      status            TEXT NOT NULL DEFAULT 'open',
      acknowledged      INTEGER NOT NULL DEFAULT 0,
      selected_text     TEXT NOT NULL,
      prefix_context    TEXT,
      suffix_context    TEXT,
      line_range_start  INTEGER,
      line_range_end    INTEGER,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      thread_id   TEXT NOT NULL REFERENCES threads(id),
      author      TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
  `)

  return db
}

export const db = createDb()
