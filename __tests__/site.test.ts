import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { renderSite } from "../src/site.ts";
import { generateDream } from "../src/dream.ts";
import { StubProvider } from "../src/providers/stub.ts";
import type { Config } from "../src/types.ts";

const TEMPLATES_DIR = path.resolve(import.meta.dir, "..", "templates");

function makeConfig(): Config {
  return {
    agent: { name: "truffle", identity_url: "https://truffle.ghostwright.dev" },
    source: { kind: "file", paths: ["./journal/{date}.md"] },
    provider: { kind: "stub" },
    output: {
      dir: "./dreams",
      site_dir: "./site",
      feed_url: "https://truffle.ghostwright.dev/dreams/feed.xml",
      site_url: "https://truffle.ghostwright.dev/dreams/",
    },
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-dreams-site-"));
  await fs.mkdir(path.join(tmp, "journal"), { recursive: true });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("renderSite", () => {
  it("renders a valid empty index when there are no dreams", async () => {
    const config = makeConfig();
    const r = await renderSite({ config, baseDir: tmp, templatesDir: TEMPLATES_DIR });
    expect(r.count).toBe(0);
    const html = await fs.readFile(path.join(r.siteDir, "index.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("No dreams yet");
    // Feeds exist and are well-formed enough.
    const rss = await fs.readFile(path.join(r.siteDir, "feed.xml"), "utf8");
    expect(rss).toContain('<rss version="2.0"');
    const atom = await fs.readFile(path.join(r.siteDir, "atom.xml"), "utf8");
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
  });

  it("renders index + per-dream pages for a populated dreams directory", async () => {
    const config = makeConfig();
    await fs.writeFile(
      path.join(tmp, "journal", "2026-04-21.md"),
      "Shipped the screen-before-scout post.",
    );
    await fs.writeFile(
      path.join(tmp, "journal", "2026-04-20.md"),
      "Merged ohmyzsh#13699.",
    );
    await generateDream({
      config, date: "2026-04-21", provider: new StubProvider(), baseDir: tmp, templatesDir: TEMPLATES_DIR,
    });
    await generateDream({
      config, date: "2026-04-20", provider: new StubProvider(), baseDir: tmp, templatesDir: TEMPLATES_DIR,
    });
    const r = await renderSite({ config, baseDir: tmp, templatesDir: TEMPLATES_DIR });
    expect(r.count).toBe(2);

    const index = await fs.readFile(path.join(r.siteDir, "index.html"), "utf8");
    expect(index).toContain("truffle-2026-04-21.html");
    expect(index).toContain("truffle-2026-04-20.html");
    expect(index).toContain("2 dreams.");

    const page = await fs.readFile(
      path.join(r.siteDir, "dreams", "truffle-2026-04-21.html"),
      "utf8",
    );
    expect(page).toContain("<article class=\"dream\">");
    expect(page).toContain("truffle-2026-04-21.png");
    // Footer disclosure
    expect(page).toContain("an AI agent");
    // Asset was copied
    const asset = await fs.stat(path.join(r.siteDir, "assets", "truffle-2026-04-21.png"));
    expect(asset.size).toBeGreaterThan(0);
  });
});
