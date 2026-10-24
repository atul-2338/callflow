import { afterEach, describe, expect, it, vi } from "vitest";
import path from "path";
import Database from "better-sqlite3";
import {
  assertPersistentDbPath,
  backfillBusinessClientUids,
  dbPathPolicyError,
  getDbPath,
  requiresPersistentDbPath,
} from "./database";

const PROJECT_DIR = path.resolve("/opt/render/project/src");
const MOUNTED = path.resolve("/var/data/callflow.db");
// Simulates "this host wipes the app disk on redeploy".
const EPHEMERAL = true;
// Simulates an unrecognised host: a laptop running `npm start`, or a VPS.
const PERSISTENT = false;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("dbPathPolicyError", () => {
  it("flags the unset DATABASE_PATH fallback on an ephemeral production host", () => {
    const error = dbPathPolicyError({
      configuredPath: undefined,
      resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      nodeEnv: "production",
      projectDir: PROJECT_DIR,
      requirePersistent: EPHEMERAL,
    });
    expect(error).toContain("DATABASE_PATH must be set in production");
  });

  it("flags a relative DATABASE_PATH when the resolved path is not absolute", () => {
    const error = dbPathPolicyError({
      configuredPath: "data/callflow.db",
      resolvedPath: "data/callflow.db",
      nodeEnv: "production",
      projectDir: PROJECT_DIR,
      requirePersistent: EPHEMERAL,
    });
    expect(error).toContain("absolute path");
  });

  it("flags a DATABASE_PATH that still sits inside the build directory", () => {
    const error = dbPathPolicyError({
      configuredPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      nodeEnv: "production",
      projectDir: PROJECT_DIR,
      requirePersistent: EPHEMERAL,
    });
    expect(error).toContain("ephemeral");
  });

  it("accepts an absolute DATABASE_PATH on the persistent disk mount", () => {
    expect(
      dbPathPolicyError({
        configuredPath: MOUNTED,
        resolvedPath: MOUNTED,
        nodeEnv: "production",
        projectDir: PROJECT_DIR,
        requirePersistent: EPHEMERAL,
      })
    ).toBeNull();
  });

  it("allows a sibling directory that merely shares a path prefix", () => {
    expect(
      dbPathPolicyError({
        configuredPath: path.resolve("/opt/render/project/src-extra/callflow.db"),
        resolvedPath: path.resolve("/opt/render/project/project/src-extra/callflow.db"),
        nodeEnv: "production",
        projectDir: PROJECT_DIR,
        requirePersistent: EPHEMERAL,
      })
    ).toBeNull();
  });

  it("never hard-fails outside production", () => {
    expect(
      dbPathPolicyError({
        configuredPath: undefined,
        resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
        nodeEnv: "development",
        projectDir: PROJECT_DIR,
        requirePersistent: EPHEMERAL,
      })
    ).toBeNull();
  });

  it("never hard-fails when the host storage is not known to be ephemeral", () => {
    expect(
      dbPathPolicyError({
        configuredPath: undefined,
        resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
        nodeEnv: "production",
        projectDir: PROJECT_DIR,
        requirePersistent: PERSISTENT,
      })
    ).toBeNull();
  });
});

describe("requiresPersistentDbPath", () => {
  it("is true when an ephemeral platform marker is present", () => {
    expect(requiresPersistentDbPath({ RENDER: "true" })).toBe(true);
    expect(requiresPersistentDbPath({ VERCEL: "1" })).toBe(true);
    expect(requiresPersistentDbPath({ FLY_APP_NAME: "callflow" })).toBe(true);
  });

  it("is true when explicitly opted in, for hosts it cannot auto-detect", () => {
    expect(requiresPersistentDbPath({ DB_REQUIRE_PERSISTENT_PATH: "1" })).toBe(true);
  });

  it("is false for a bare production run on an unrecognised host", () => {
    expect(requiresPersistentDbPath({ NODE_ENV: "production" })).toBe(false);
  });

  it("ignores markers that are empty or literally false", () => {
    expect(requiresPersistentDbPath({ RENDER: "", VERCEL: "false" })).toBe(false);
  });
});

describe("getDbPath", () => {
  it("resolves a relative DATABASE_PATH to an absolute path against the project cwd", () => {
    vi.stubEnv("DATABASE_PATH", "data/relative-check.db");
    const resolved = getDbPath();
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.resolve(process.cwd(), "data/relative-check.db"));
  });

  it("leaves an absolute DATABASE_PATH untouched", () => {
    vi.stubEnv("DATABASE_PATH", MOUNTED);
    expect(getDbPath()).toBe(MOUNTED);
  });

  it("falls back to the absolute in-repo default when unset", () => {
    delete process.env.DATABASE_PATH;
    expect(path.isAbsolute(getDbPath())).toBe(true);
    expect(getDbPath()).toBe(path.join(process.cwd(), "data", "callflow.db"));
  });
});

describe("assertPersistentDbPath", () => {
  it("throws on the first DB access when an ephemeral deploy would lose data", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RENDER", "true");
    delete process.env.DATABASE_PATH;
    expect(() => assertPersistentDbPath(getDbPath())).toThrow(
      /\[database\] DATABASE_PATH must be set in production/
    );
  });

  it("passes when DATABASE_PATH points outside the project directory", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RENDER", "true");
    process.env.DATABASE_PATH = MOUNTED;
    expect(() => assertPersistentDbPath(getDbPath())).not.toThrow();
  });

  it("resolves a relative DATABASE_PATH to inside the project and hard-fails on an ephemeral host", () => {
    // Runtime shape: getDbPath() resolves a relative DATABASE_PATH against the
    // project cwd, so the guard receives an absolute path that still sits in
    // the ephemeral app directory and must reject it for that reason.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RENDER", "true");
    process.env.DATABASE_PATH = "data/callflow.db";
    expect(() => assertPersistentDbPath(getDbPath())).toThrow(
      /\[database\] DATABASE_PATH must live outside the app directory/
    );
  });

  it("uses the default path in a production run on a local machine", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_PATH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertPersistentDbPath(getDbPath())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("DATABASE_PATH is not set")
    );
  });

  it("still throws in production when opted in without a platform marker", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DB_REQUIRE_PERSISTENT_PATH", "1");
    delete process.env.DATABASE_PATH;
    expect(() => assertPersistentDbPath(getDbPath())).toThrow(
      /\[database\] DATABASE_PATH must be set in production/
    );
  });

  it("stays silent in development when DATABASE_PATH is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.DATABASE_PATH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertPersistentDbPath(getDbPath())).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet when DATABASE_PATH is explicitly configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.DATABASE_PATH = MOUNTED;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertPersistentDbPath(getDbPath());
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("backfillBusinessClientUids", () => {
  function setup(): Database.Database {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE businesses (id TEXT PRIMARY KEY, clientUid TEXT)");
    return db;
  }

  it("fills NULL clientUid rows with unique, well-formed UIDs", () => {
    const db = setup();
    const insert = db.prepare(
      "INSERT INTO businesses (id, clientUid) VALUES (?, ?)"
    );
    insert.run("biz-1", null);
    insert.run("biz-2", null);
    insert.run("biz-3", "TE-deadbeef");

    backfillBusinessClientUids(db);

    const rows = db
      .prepare("SELECT id, clientUid FROM businesses ORDER BY id")
      .all() as Array<{ id: string; clientUid: string | null }>;
    expect(rows[0].clientUid).toMatch(/^TE-[0-9a-f]{8}$/);
    expect(rows[1].clientUid).toMatch(/^TE-[0-9a-f]{8}$/);
    expect(rows[0].clientUid).not.toBe(rows[1].clientUid);
    // A pre-existing UID is never rotated by the backfill.
    expect(rows[2].clientUid).toBe("TE-deadbeef");
    db.close();
  });

  it("is a no-op when every row already has a UID", () => {
    const db = setup();
    db.prepare("INSERT INTO businesses (id, clientUid) VALUES (?, ?)").run(
      "biz-1",
      "TE-cafebabe"
    );

    backfillBusinessClientUids(db);

    const row = db
      .prepare("SELECT clientUid FROM businesses WHERE id = 'biz-1'")
      .get() as { clientUid: string };
    expect(row.clientUid).toBe("TE-cafebabe");
    db.close();
  });
});