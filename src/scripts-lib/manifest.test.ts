import { describe, it, expect } from "vitest";
import { parseManifest, scanScripts } from "./manifest.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("manifest", () => {
  it("parses db_query.py docstring", () => {
    const mf = parseManifest(path.join(ROOT, "scripts", "db_query.py"));
    expect(mf).not.toBeNull();
    expect(mf!.name).toBe("db_query");
    expect(mf!.description).toContain("只读");
    expect(mf!.timeoutSec).toBe(30);
    expect(mf!.params.map((p) => p.name)).toEqual(["sql", "limit"]);
    expect(mf!.params[0].desc).toContain("必填");
  });

  it("rejects plain scripts without name declaration", () => {
    expect(parseManifest(path.join(ROOT, "src", "manifest.test.absent.py"))).toBeNull();
  });

  it("scanScripts registers all manifest-declaring scripts", () => {
    const list = scanScripts(path.join(ROOT, "scripts"));
    const names = list.map((s) => s.name);
    expect(names).toContain("db_query");
    expect(names).toContain("export_xlsx");
  });
});
