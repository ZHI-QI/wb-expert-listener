import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "./index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
let db: Database.Database;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wb-listener-test-"));
  db = new Database(path.join(dir, "test.db"));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("migrate", () => {
  it("creates all 5 tables", () => {
    migrate(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of ["user_sessions", "chat_logs", "summaries", "script_audit", "kv"]) {
      expect(names).toContain(t);
    }
  });

  it("is idempotent (run twice, no error)", () => {
    expect(() => migrate(db)).not.toThrow();
  });

  it("kv roundtrip works", () => {
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run("kb.mode", "okf");
    const v = db.prepare("SELECT value FROM kv WHERE key = ?").get("kb.mode") as { value: string };
    expect(v.value).toBe("okf");
  });
});
