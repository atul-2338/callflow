import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Path to the SQLite database file. Overridable via DATABASE_PATH so that
// production deployments can point it at a persistent disk mount. Defaults to
// ./data/callflow.db for local development.
const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "callflow.db");
const SCHEMA_PATH = path.join(process.cwd(), "migrations", "schema.sql");

let db: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.DATABASE_PATH?.trim() || DEFAULT_DB_PATH;
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  instance.exec(schema);

  db = instance;
  return instance;
}
