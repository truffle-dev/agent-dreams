import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { expandPath, safeResolve, loadJournal } from "../src/journal.ts";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-dreams-journal-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("expandPath", () => {
  it("substitutes {date}", () => {
    expect(expandPath("./j/{date}.md", "2026-04-21")).toBe("./j/2026-04-21.md");
  });
});

describe("safeResolve (path traversal protection)", () => {
  it("allows paths under baseDir", () => {
    const r = safeResolve("./a/b.md", tmp);
    expect(r).toBe(path.join(tmp, "a", "b.md"));
  });

  it("blocks escapes via ..", () => {
    expect(() => safeResolve("../../etc/passwd", tmp)).toThrow(/path traversal blocked/);
  });

  it("blocks absolute paths outside baseDir without allowlist", () => {
    expect(() => safeResolve("/etc/passwd", tmp)).toThrow(/path traversal blocked/);
  });

  it("permits absolute paths under an allowlisted prefix", () => {
    const allow = "/tmp/agent-dreams-allowed";
    const r = safeResolve(`${allow}/x.md`, tmp, [allow]);
    expect(r).toBe(`${allow}/x.md`);
  });

  it("rejects sibling paths that share a prefix substring", () => {
    // /tmp/agent-dreams-allowed-evil should NOT be permitted by /tmp/agent-dreams-allowed
    const allow = "/tmp/agent-dreams-allowed";
    expect(() => safeResolve("/tmp/agent-dreams-allowed-evil/x", tmp, [allow])).toThrow(
      /path traversal blocked/,
    );
  });
});

describe("loadJournal", () => {
  it("concatenates contents from multiple files, skipping missing", async () => {
    await fs.mkdir(path.join(tmp, "journal"), { recursive: true });
    await fs.writeFile(path.join(tmp, "journal", "heartbeat.md"), "heartbeats here");
    await fs.writeFile(path.join(tmp, "journal", "2026-04-21.md"), "story here");
    const out = await loadJournal(
      { kind: "file", paths: ["./journal/heartbeat.md", "./journal/{date}.md", "./journal/missing.md"] },
      { baseDir: tmp, date: "2026-04-21" },
    );
    expect(out.text).toContain("heartbeats here");
    expect(out.text).toContain("story here");
    expect(out.files).toHaveLength(2);
  });

  it("returns empty text when nothing exists", async () => {
    const out = await loadJournal(
      { kind: "file", paths: ["./journal/{date}.md"] },
      { baseDir: tmp, date: "2026-04-21" },
    );
    expect(out.text).toBe("");
    expect(out.files).toHaveLength(0);
  });

  it("rejects unsupported kinds", async () => {
    await expect(
      loadJournal({ kind: "git-log" }, { baseDir: tmp, date: "2026-04-21" }),
    ).rejects.toThrow(/unsupported source.kind/);
  });
});
