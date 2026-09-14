import { afterEach, describe, expect, it, vi } from "vitest";
import path from "path";
import {
  assertPersistentDbPath,
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

  it("flags a relative DATABASE_PATH on an ephemeral production host", () => {
    const error = dbPathPolicyError({
      configuredPath: "data/callflow.db",
      resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
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

  it("uses the default path in a production run on a local machine", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_PATH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertPersistentDbPath(getDbPath())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("the DATABASE_PATH guard is off")
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

  it("warns but does not throw when the local default is used in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.DATABASE_PATH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertPersistentDbPath(getDbPath())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DATABASE_PATH is not set"));
  });

  it("stays quiet when DATABASE_PATH is explicitly configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.DATABASE_PATH = MOUNTED;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertPersistentDbPath(getDbPath());
    expect(warn).not.toHaveBeenCalled();
  });
});
