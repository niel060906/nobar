import Database from 'better-sqlite3';
import path from 'path';

// Connect to SQLite database
const db = new Database(process.env.NODE_ENV === 'production' ? path.join(process.cwd(), 'data.sqlite') : ':memory:');

export async function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL,
      hostId TEXT NOT NULL,
      status TEXT DEFAULT 'WAITING',
      sequence INTEGER DEFAULT 0,
      queue TEXT,
      currentMediaIndex INTEGER DEFAULT -1,
      playing BOOLEAN DEFAULT 0,
      position REAL DEFAULT 0,
      playbackRate REAL DEFAULT 1,
      updatedAt INTEGER,
      settings TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS room_members (
      roomId TEXT,
      userId TEXT,
      displayName TEXT,
      role TEXT,
      joinedAt INTEGER,
      lastSeen INTEGER,
      status TEXT DEFAULT 'online',
      isMuted BOOLEAN DEFAULT 0,
      PRIMARY KEY (roomId, userId)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS banned_users (
      roomId TEXT,
      userId TEXT,
      bannedAt INTEGER,
      PRIMARY KEY (roomId, userId)
    )
  `);
}

export { db };
