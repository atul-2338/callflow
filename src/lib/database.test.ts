import { afterEach, describe, expect, it, vi } from "vitest";
import path from "path";
import {
  assertPersistentDbPath,
  dbPathPolicyError,
  getDbPath,
} from "./database";

const PROJECT_DIR = path.resolve("/opt/render/project/src");
const MOUNTED = path.resolve("/var/data/callflow.db");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("dbPathPolicyError", () => {
  it("flags the unset DATABASE_PATH fallback in production (silent data loss)", () => {
    const error = dbPathPolicyError({
      configuredPath: undefined,
      resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      nodeEnv: "production",
      projectDir: PROJECT_DIR,
    });
    expect(error).toContain("DATABASE_PATH must be set in production");
  });

  it("flags a relative DATABASE_PATH in production", () => {
    const error = dbPathPolicyError({
      configuredPath: "data/callflow.db",
      resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      nodeEnv: "production",
      projectDir: PROJECT_DIR,
    });
    expect(error).toContain("absolute path");
  });

  it("flags a DATABASE_PATH that still sits inside the build directory", () => {
    const error = dbPathPolicyError({
      configuredPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      resolvedPath: path.join(PROJECT_DIR, "data", "callflow.db"),
      nodeEnv: "production",
      projectDir: PROJECT_DIR,
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
      })
    ).toBeNull();
  });
});

describe("assertPersistentDbPath", () => {
  it("throws on the first DB access when a production deploy would lose data", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_PATH;
    expect(() => assertPersistentDbPath(getDbPath())).toThrow(
      /\[database\] DATABASE_PATH must be set in production/
    );
  });

  it("passes when DATABASE_PATH points outside the project directory", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATABASE_PATH = MOUNTED;
    expect(() => assertPersistentDbPath(getDbPath())).not.toThrow();
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
