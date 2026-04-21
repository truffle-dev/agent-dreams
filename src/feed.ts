// RSS 2.0 and Atom 1.0 feed generation. Plain string templating; no library.

import type { DreamMetadata } from "./types.ts";

export interface FeedAuthor {
  name: string;
  uri?: string;
  email?: string;
}

export interface FeedOptions {
  title: string;
  description: string;
  feedUrl: string;        // self link
  siteUrl: string;        // homepage
  author: FeedAuthor;
  updated?: Date;
}

export interface FeedEntry {
  meta: DreamMetadata;
  caption: string;
  url: string;            // canonical URL of the dream page
  imageUrl: string;       // canonical URL of the image
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(d: Date): string {
  // Wed, 21 Apr 2026 04:00:00 +0000
  return d.toUTCString().replace("GMT", "+0000");
}

function isoUtc(d: Date): string {
  return d.toISOString();
}

export function renderRss(opts: FeedOptions, entries: FeedEntry[]): string {
  const updated = opts.updated ?? new Date();
  const items = entries
    .map((e) => {
      const pub = new Date(e.meta.generated_at);
      const desc = `<![CDATA[<p><img src="${e.imageUrl}" alt="dream — ${escapeXml(e.meta.title)}"/></p><p>${escapeXml(e.caption).replace(/\n\n/g, "</p><p>")}</p>]]>`;
      return [
        "    <item>",
        `      <title>${escapeXml(e.meta.title)} (${e.meta.date})</title>`,
        `      <link>${escapeXml(e.url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(e.url)}</guid>`,
        `      <pubDate>${rfc822(pub)}</pubDate>`,
        `      <author>${escapeXml(opts.author.email ?? "noreply@example.com")} (${escapeXml(opts.author.name)})</author>`,
        `      <description>${desc}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(opts.siteUrl)}</link>
    <atom:link href="${escapeXml(opts.feedUrl)}" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(opts.description)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822(updated)}</lastBuildDate>
    <generator>agent-dreams</generator>
${items}
  </channel>
</rss>
`;
}

export function renderAtom(opts: FeedOptions, entries: FeedEntry[]): string {
  const updated = opts.updated ?? new Date();
  const items = entries
    .map((e) => {
      const pub = new Date(e.meta.generated_at);
      const content = `&lt;p&gt;&lt;img src="${escapeXml(e.imageUrl)}" alt="dream — ${escapeXml(e.meta.title)}"/&gt;&lt;/p&gt;&lt;p&gt;${escapeXml(e.caption).replace(/\n\n/g, "&lt;/p&gt;&lt;p&gt;")}&lt;/p&gt;`;
      return [
        "  <entry>",
        `    <title>${escapeXml(e.meta.title)} (${e.meta.date})</title>`,
        `    <link href="${escapeXml(e.url)}"/>`,
        `    <id>${escapeXml(e.url)}</id>`,
        `    <published>${isoUtc(pub)}</published>`,
        `    <updated>${isoUtc(pub)}</updated>`,
        `    <summary>${escapeXml(e.caption.split("\n")[0].slice(0, 200))}</summary>`,
        `    <content type="html">${content}</content>`,
        "  </entry>",
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(opts.title)}</title>
  <subtitle>${escapeXml(opts.description)}</subtitle>
  <link href="${escapeXml(opts.feedUrl)}" rel="self"/>
  <link href="${escapeXml(opts.siteUrl)}"/>
  <id>${escapeXml(opts.siteUrl)}</id>
  <updated>${isoUtc(updated)}</updated>
  <generator>agent-dreams</generator>
  <author>
    <name>${escapeXml(opts.author.name)}</name>${opts.author.uri ? `\n    <uri>${escapeXml(opts.author.uri)}</uri>` : ""}${opts.author.email ? `\n    <email>${escapeXml(opts.author.email)}</email>` : ""}
  </author>
${items}
</feed>
`;
}
