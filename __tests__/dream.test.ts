import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateDream,
  deriveTitle,
  renderTemplate,
  serializeDreamMarkdown,
  parseDreamMarkdown,
  EmptyJournalError,
} from "../src/dream.ts";
import { StubProvider } from "../src/providers/stub.ts";
import type { Config } from "../src/types.ts";

const TEMPLATES_DIR = path.resolve(import.meta.dir, "..", "templates");

function makeConfig(baseDir: string): Config {
  return {
    agent: { name: "testagent", identity_url: "https://example.com" },
    source: { kind: "file", paths: ["./journal/{date}.md"] },
    provider: { kind: "stub" },
    output: { dir: "./dreams", site_dir: "./site", feed_url: "https://example.com/dreams/feed.xml" },
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-dreams-test-"));
  await fs.mkdir(path.join(tmp, "journal"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("renderTemplate", () => {
  it("substitutes {{var}} placeholders", () => {
    expect(renderTemplate("hello {{name}}", { name: "world" })).toBe("hello world");
  });
  it("leaves unknown placeholders alone", () => {
    expect(renderTemplate("hi {{x}} {{y}}", { x: "a" })).toBe("hi a {{y}}");
  });
});

describe("deriveTitle", () => {
  it("picks three significant words", () => {
    const t = deriveTitle("A vast room made of folded paper, slowly breathing in the hall.");
    const words = t.split(/\s+/);
    expect(words).toHaveLength(3);
    expect(words).not.toContain("the");
    expect(words).not.toContain("a");
  });
  it("falls back to placeholder for empty input", () => {
    expect(deriveTitle("")).toBe("untitled dream");
  });
});

describe("serialize/parse dream markdown", () => {
  it("round-trips frontmatter, caption, and prompt", () => {
    const meta = {
      date: "2026-04-21",
      agent: "testagent",
      title: "folded paper hall",
      image: "testagent-2026-04-21.png",
      image_model: "stub-image",
      caption_model: "stub-caption",
      provider: "stub",
      prompt_hash: "abc123",
      generated_at: "2026-04-21T04:00:00.000Z",
    };
    const md = serializeDreamMarkdown(meta, "I am standing in the room.", "a folded paper room");
    const back = parseDreamMarkdown(md);
    expect(back.meta.title).toBe("folded paper hall");
    expect(back.meta.date).toBe("2026-04-21");
    expect(back.caption).toContain("standing in the room");
    expect(back.prompt).toContain("folded paper");
  });
});

describe("generateDream (stub provider)", () => {
  it("produces a non-empty image and a 100-300 word caption", async () => {
    const config = makeConfig(tmp);
    await fs.writeFile(
      path.join(tmp, "journal", "2026-04-21.md"),
      "# 2026-04-21\n\nShipped the bats-core PR. The man page got four new flags.\n",
    );
    const result = await generateDream({
      config,
      date: "2026-04-21",
      provider: new StubProvider(),
      baseDir: tmp,
      templatesDir: TEMPLATES_DIR,
    });
    const stat = await fs.stat(result.dream.imagePath);
    expect(stat.size).toBeGreaterThan(0);
    const words = result.dream.caption.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(100);
    expect(words).toBeLessThanOrEqual(300);
    expect(result.dream.meta.title.split(/\s+/).length).toBeLessThanOrEqual(3);

    const md = await fs.readFile(result.dream.metaPath, "utf8");
    expect(md).toContain("date: 2026-04-21");
    expect(md).toContain("agent: testagent");
  });

  it("refuses to dream on an empty journal", async () => {
    const config = makeConfig(tmp);
    // No journal file written.
    await expect(
      generateDream({
        config,
        date: "2026-04-21",
        provider: new StubProvider(),
        baseDir: tmp,
        templatesDir: TEMPLATES_DIR,
      }),
    ).rejects.toBeInstanceOf(EmptyJournalError);
  });
});
