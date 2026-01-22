import { mkdir } from "fs/promises";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CACHE_DB_DIR, CACHE_DB_PATH } from "./config";

const downloads = sqliteTable("downloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotifyUrn: text("spotify_urn").notNull(),
  tidalId: integer("tidal_id"),
});

type DownloadRow = typeof downloads.$inferSelect;

let dbInstance: ReturnType<typeof drizzle> | null = null;

function ensureSchema(db: Database): void {
  const tableExists = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='downloads'")
    .all();

  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spotify_urn TEXT NOT NULL,
      tidal_id INTEGER NOT NULL,
      UNIQUE(spotify_urn)
    );
  `);

  if (tableExists.length === 0) {
    return;
  }

  const columns = db.query("PRAGMA table_info(downloads)").all() as Array<{ name: string; notnull: number }>;
  const hasIdColumn = columns.some((column) => column.name === "id");
  const tidalColumn = columns.find((column) => column.name === "tidal_id");
  const tidalAllowsNull = tidalColumn ? tidalColumn.notnull === 0 : false;

  if (!hasIdColumn || !tidalAllowsNull) {
    try {
      db.exec("BEGIN;");
      db.exec("DROP TABLE IF EXISTS downloads_new;");
      db.exec(`
        CREATE TABLE downloads_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spotify_urn TEXT NOT NULL,
          tidal_id INTEGER,
          UNIQUE(spotify_urn)
        );
      `);
      db.exec("INSERT INTO downloads_new (spotify_urn, tidal_id) SELECT spotify_urn, tidal_id FROM downloads;");
      db.exec("DROP TABLE downloads;");
      db.exec("ALTER TABLE downloads_new RENAME TO downloads;");
      db.exec("COMMIT;");
    } catch {
      db.exec("ROLLBACK;");
      db.exec("DROP TABLE IF EXISTS downloads_new;");
      db.exec("DROP TABLE IF EXISTS downloads;");
      db.exec(`
        CREATE TABLE downloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spotify_urn TEXT NOT NULL,
          tidal_id INTEGER,
          UNIQUE(spotify_urn)
        );
      `);
    }
  }
}

async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  await mkdir(CACHE_DB_DIR, { recursive: true });
  const sqlite = new Database(CACHE_DB_PATH);
  ensureSchema(sqlite);
  dbInstance = drizzle(sqlite);
  return dbInstance;
}

export async function getCachedDownload(spotifyUrn: string): Promise<DownloadRow | null> {
  const db = await getDb();
  const rows = await db.select().from(downloads).where(eq(downloads.spotifyUrn, spotifyUrn));
  return rows[0] ?? null;
}

export async function recordDownload(spotifyUrn: string, tidalId: number | null): Promise<void> {
  const db = await getDb();
  await db.insert(downloads).values({ spotifyUrn, tidalId }).onConflictDoNothing();
}
