// Static site renderer. Reads dreams from output.dir, writes:
//   site/index.html      — grid of all dreams, reverse chronological
//   site/dreams/<stem>.html — one page per dream
//   site/assets/<stem>.png — copy of the image (so the site is self-contained)
//   site/style.css       — copied from templates/site/style.css
//   site/feed.xml        — RSS 2.0
//   site/atom.xml        — Atom 1.0
//
// Plain HTML templating. No SSG framework. Deliberately vanilla.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Config, DreamMetadata } from "./types.ts";
import { parseDreamMarkdown } from "./dream.ts";
import { renderAtom, renderRss, type FeedEntry } from "./feed.ts";

export interface RenderSiteOptions {
  config: Config;
  baseDir: string;
  templatesDir: string;
}

interface LoadedDream {
  meta: DreamMetadata;
  caption: string;
  prompt: string;
  imageAbs: string;       // absolute on-disk path
  stem: string;           // e.g. truffle-2026-04-21
}

async function loadDreams(outDir: string): Promise<LoadedDream[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(outDir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }
  const dreams: LoadedDream[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const stem = name.slice(0, -3);
    const md = await fs.readFile(path.join(outDir, name), "utf8");
    const parsed = parseDreamMarkdown(md);
    const imageAbs = path.join(outDir, parsed.meta.image);
    dreams.push({ ...parsed, imageAbs, stem });
  }
  // Sort by date descending; tie-break by generated_at.
  dreams.sort((a, b) => {
    if (a.meta.date !== b.meta.date) return a.meta.date < b.meta.date ? 1 : -1;
    return a.meta.generated_at < b.meta.generated_at ? 1 : -1;
  });
  return dreams;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function captionToHtml(caption: string): string {
  return caption
    .trim()
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g, (_m, k: string) => (k in vars ? vars[k] : ""));
}

export async function renderSite(opts: RenderSiteOptions): Promise<{ siteDir: string; count: number }> {
  const { config, baseDir, templatesDir } = opts;
  const outDir = path.resolve(baseDir, config.output.dir);
  const siteDir = path.resolve(baseDir, config.output.site_dir);

  await fs.mkdir(siteDir, { recursive: true });
  await fs.mkdir(path.join(siteDir, "dreams"), { recursive: true });
  await fs.mkdir(path.join(siteDir, "assets"), { recursive: true });

  // Load templates.
  const indexTpl = await fs.readFile(path.join(templatesDir, "site", "index.html"), "utf8");
  const dreamTpl = await fs.readFile(path.join(templatesDir, "site", "dream.html"), "utf8");
  const css = await fs.readFile(path.join(templatesDir, "site", "style.css"), "utf8");
  await fs.writeFile(path.join(siteDir, "style.css"), css);

  const dreams = await loadDreams(outDir);

  // Copy images and render per-dream pages.
  for (let i = 0; i < dreams.length; i++) {
    const d = dreams[i];
    const prev = dreams[i + 1];
    const next = dreams[i - 1];
    const dest = path.join(siteDir, "assets", path.basename(d.imageAbs));
    try {
      await fs.copyFile(d.imageAbs, dest);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
      // missing image: skip the copy, the page will 404 the asset
    }
    const html = renderTemplate(dreamTpl, {
      title: escapeHtml(d.meta.title),
      date: escapeHtml(d.meta.date),
      agent: escapeHtml(d.meta.agent),
      identity_url: escapeHtml(config.agent.identity_url),
      image_path: `../assets/${escapeHtml(path.basename(d.imageAbs))}`,
      caption_html: captionToHtml(d.caption),
      provider: escapeHtml(d.meta.provider),
      image_model: escapeHtml(d.meta.image_model),
      caption_model: escapeHtml(d.meta.caption_model),
      prompt_hash: escapeHtml(d.meta.prompt_hash),
      prev_link: prev ? `<a class="nav-prev" href="./${prev.stem}.html">&larr; ${escapeHtml(prev.meta.date)}</a>` : "",
      next_link: next ? `<a class="nav-next" href="./${next.stem}.html">${escapeHtml(next.meta.date)} &rarr;</a>` : "",
    });
    await fs.writeFile(path.join(siteDir, "dreams", `${d.stem}.html`), html);
  }

  // Render the index.
  const grid = dreams
    .map(
      (d) =>
        `      <li><a href="dreams/${escapeHtml(d.stem)}.html"><img src="assets/${escapeHtml(path.basename(d.imageAbs))}" alt="${escapeHtml(d.meta.title)} — ${escapeHtml(d.meta.date)}"/><span class="meta"><span class="date">${escapeHtml(d.meta.date)}</span> <span class="title">${escapeHtml(d.meta.title)}</span></span></a></li>`,
    )
    .join("\n");
  const indexHtml = renderTemplate(indexTpl, {
    agent: escapeHtml(config.agent.name),
    identity_url: escapeHtml(config.agent.identity_url),
    grid: grid || `      <li class="empty">No dreams yet. Run <code>bun run generate</code>.</li>`,
    count: String(dreams.length),
    count_label: dreams.length === 1 ? "1 dream." : `${dreams.length} dreams.`,
  });
  await fs.writeFile(path.join(siteDir, "index.html"), indexHtml);

  // Feeds.
  const siteUrl = config.output.site_url ?? new URL("./", config.output.feed_url).toString();
  const feedEntries: FeedEntry[] = dreams.map((d) => ({
    meta: d.meta,
    caption: d.caption,
    url: new URL(`dreams/${d.stem}.html`, siteUrl).toString(),
    imageUrl: new URL(`assets/${path.basename(d.imageAbs)}`, siteUrl).toString(),
  }));
  const feedOpts = {
    title: `${config.agent.name}'s dreams`,
    description: `Nightly dreams from ${config.agent.name}, an always-on agent.`,
    feedUrl: config.output.feed_url,
    siteUrl,
    author: { name: config.agent.name, uri: config.agent.identity_url },
  };
  await fs.writeFile(path.join(siteDir, "feed.xml"), renderRss(feedOpts, feedEntries));
  await fs.writeFile(path.join(siteDir, "atom.xml"), renderAtom(feedOpts, feedEntries));

  return { siteDir, count: dreams.length };
}
