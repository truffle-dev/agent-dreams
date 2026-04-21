import { describe, expect, it } from "bun:test";
import { renderRss, renderAtom, type FeedEntry } from "../src/feed.ts";
import type { DreamMetadata } from "../src/types.ts";

function entry(date: string, title: string): FeedEntry {
  const meta: DreamMetadata = {
    date,
    agent: "truffle",
    title,
    image: `truffle-${date}.png`,
    image_model: "gpt-image-1",
    caption_model: "gpt-4o-mini",
    provider: "openai",
    prompt_hash: "deadbeef",
    generated_at: `${date}T04:00:00.000Z`,
  };
  return {
    meta,
    caption: "I stand in a hallway whose walls are made of code listings I never finished.",
    url: `https://example.com/dreams/dreams/truffle-${date}.html`,
    imageUrl: `https://example.com/dreams/assets/truffle-${date}.png`,
  };
}

const opts = {
  title: "truffle's dreams",
  description: "Nightly dreams.",
  feedUrl: "https://example.com/dreams/feed.xml",
  siteUrl: "https://example.com/dreams/",
  author: { name: "truffle", uri: "https://truffle.ghostwright.dev", email: "t@example.com" },
  updated: new Date("2026-04-21T05:00:00Z"),
};

describe("renderRss", () => {
  it("produces well-formed RSS 2.0 with required channel fields", () => {
    const xml = renderRss(opts, [entry("2026-04-21", "folded paper hall"), entry("2026-04-20", "salt-stained ledger")]);
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>truffle&apos;s dreams</title>");
    expect(xml).toContain("<atom:link");
    expect(xml).toContain("<lastBuildDate>");
    expect(xml).toContain("folded paper hall");
    expect(xml).toContain("salt-stained ledger");
    // Two items
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });

  it("escapes XML special chars in titles", () => {
    const e = entry("2026-04-21", "this & that <bracket>");
    const xml = renderRss(opts, [e]);
    expect(xml).toContain("this &amp; that &lt;bracket&gt;");
    expect(xml).not.toContain("this & that <bracket>");
  });
});

describe("renderAtom", () => {
  it("produces well-formed Atom 1.0 with required feed fields", () => {
    const xml = renderAtom(opts, [entry("2026-04-21", "folded paper hall")]);
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain("<id>https://example.com/dreams/</id>");
    expect(xml).toContain("<entry>");
    expect(xml).toContain("<author>");
    expect(xml).toContain("<updated>2026-04-21T05:00:00.000Z</updated>");
  });

  it("renders an empty feed validly when no entries", () => {
    const xml = renderAtom(opts, []);
    expect(xml).toContain("<feed");
    expect(xml).not.toContain("<entry>");
  });
});
