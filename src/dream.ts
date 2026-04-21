// Core dream generation. Pipeline:
//   1. Load day signal (journal.ts)
//   2. Build dream prompt from template + signal
//   3. Image provider produces the image
//   4. Caption provider produces the caption
//   5. Write image + .md metadata to dreams/<date>.{png,md}

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Config, Dream, DreamMetadata } from "./types.ts";
import type { DreamProvider } from "./providers/types.ts";
import { loadJournal } from "./journal.ts";

export interface GenerateDreamOptions {
  config: Config;
  date: string;                 // YYYY-MM-DD UTC
  provider: DreamProvider;
  baseDir: string;              // working directory for relative paths
  absoluteAllowlist?: string[]; // for journals that live outside baseDir
  templatesDir: string;         // where dream-prompt.md and caption-prompt.md live
  /**
   * Optional override: if provided, this function is called with the rendered
   * dream-prompt template + day signal and must return the final image prompt.
   * If omitted, the rendered template IS the final prompt (the template
   * instructs the model to do the work, but here the "model" is the same one
   * generating the image — for OpenAI gpt-image-1 we pass the rendered
   * instruction-prompt directly, which produces a dream-shaped image. For
   * adopters who want a two-stage flow — text model writes the image prompt
   * first, image model renders — pass a function here.)
   */
  composeImagePrompt?: (rendered: string, daySignal: string) => Promise<string>;
}

export interface GenerationResult {
  dream: Dream;
  daySignal: string;
}

/** Render a {{var}}-style template with the given values. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g, (_m, key: string) => {
    return key in vars ? vars[key] : `{{${key}}}`;
  });
}

/** Three-word evocation derived from the prompt. Used for titles. */
export function deriveTitle(prompt: string): string {
  // Pick the first three resonant words: skip stopwords, filter punctuation.
  const stop = new Set([
    "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
    "with", "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "do", "does", "did", "i", "you", "it", "this", "that", "these", "those",
    "as", "by", "from", "into", "over", "under", "out", "up", "down",
  ]);
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  const picked = words.slice(0, 3);
  if (picked.length === 0) return "untitled dream";
  return picked.join(" ");
}

const NO_DREAM_SENTINEL = "NO_DREAM";

export class NoDreamError extends Error {
  constructor() {
    super("the day signal contained no resonant detail; no dream produced");
    this.name = "NoDreamError";
  }
}

export class EmptyJournalError extends Error {
  constructor() {
    super("day signal was empty; refusing to produce a generic surreal dream");
    this.name = "EmptyJournalError";
  }
}

export async function generateDream(opts: GenerateDreamOptions): Promise<GenerationResult> {
  const { config, date, provider, baseDir, absoluteAllowlist, templatesDir } = opts;

  // 1. Load the day's signal.
  const journal = await loadJournal(config.source, { baseDir, absoluteAllowlist, date });
  if (!journal.text.trim()) {
    throw new EmptyJournalError();
  }

  // 2. Build the dream prompt from template.
  const dreamTemplate = await fs.readFile(path.join(templatesDir, "dream-prompt.md"), "utf8");
  const renderedDreamPrompt = renderTemplate(dreamTemplate, {
    agent_name: config.agent.name,
    date,
    day_signal: journal.text,
  });

  // Two-stage flow. The template is an *instruction* for a text model to
  // write the image prompt. We call the caption provider first to turn the
  // instruction into a concrete image-generation paragraph, then hand that
  // paragraph to the image model.
  //
  // Adopters can pass `composeImagePrompt` to plug in a different text model.
  // The stub provider's `caption` method works here too — it just echoes, so
  // tests don't need to short-circuit this path.
  const composer = opts.composeImagePrompt
    ? (rendered: string, signal: string) => opts.composeImagePrompt!(rendered, signal)
    : async (rendered: string) => {
        const r = await provider.caption(rendered, { model: config.provider.caption_model });
        return r.text;
      };
  const composed = (await composer(renderedDreamPrompt, journal.text)).trim();
  if (composed === NO_DREAM_SENTINEL || composed.toUpperCase().startsWith("NO_DREAM")) {
    throw new NoDreamError();
  }
  const imagePrompt = composed;

  // 3. Image.
  const imageRes = await provider.generate(imagePrompt, {
    quality: config.provider.image_quality,
    model: config.provider.image_model,
    size: "1024x1024",
  });

  // 4. Caption.
  const captionTemplate = await fs.readFile(path.join(templatesDir, "caption-prompt.md"), "utf8");
  const renderedCaptionPrompt = renderTemplate(captionTemplate, {
    agent_name: config.agent.name,
    date,
    dream_prompt: imagePrompt,
    day_signal_excerpt: journal.text.slice(0, 2000),
  });
  const captionRes = await provider.caption(renderedCaptionPrompt, {
    model: config.provider.caption_model,
  });

  // 5. Write to disk.
  const outDir = path.resolve(baseDir, config.output.dir);
  await fs.mkdir(outDir, { recursive: true });
  const stem = `${config.agent.name}-${date}`;
  const imagePath = path.join(outDir, `${stem}.png`);
  const metaPath = path.join(outDir, `${stem}.md`);

  await fs.writeFile(imagePath, imageRes.bytes);

  const promptHash = crypto.createHash("sha256").update(imagePrompt).digest("hex").slice(0, 16);
  const meta: DreamMetadata = {
    date,
    agent: config.agent.name,
    title: deriveTitle(imagePrompt),
    image: path.basename(imagePath),
    image_model: imageRes.model,
    caption_model: captionRes.model,
    provider: provider.name,
    prompt_hash: promptHash,
    generated_at: new Date().toISOString(),
  };

  const md = serializeDreamMarkdown(meta, captionRes.text, imagePrompt);
  await fs.writeFile(metaPath, md);

  return {
    dream: {
      meta,
      prompt: imagePrompt,
      caption: captionRes.text,
      imagePath,
      metaPath,
    },
    daySignal: journal.text,
  };
}

/** Serialize a dream's metadata + caption to a Markdown file with YAML frontmatter. */
export function serializeDreamMarkdown(
  meta: DreamMetadata,
  caption: string,
  prompt: string,
): string {
  const fm = [
    "---",
    `date: ${meta.date}`,
    `agent: ${meta.agent}`,
    `title: ${JSON.stringify(meta.title)}`,
    `image: ${meta.image}`,
    `image_model: ${meta.image_model}`,
    `caption_model: ${meta.caption_model}`,
    `provider: ${meta.provider}`,
    `prompt_hash: ${meta.prompt_hash}`,
    `generated_at: ${meta.generated_at}`,
    "---",
  ].join("\n");
  return `${fm}\n\n${caption.trim()}\n\n<!-- prompt:\n${prompt.trim()}\n-->\n`;
}

/** Parse a dream's Markdown file back into metadata + caption. */
export function parseDreamMarkdown(text: string): { meta: DreamMetadata; caption: string; prompt: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("dream markdown: missing YAML frontmatter");
  const fm = m[1];
  const rest = m[2];
  const meta: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.+)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
    meta[kv[1]] = v;
  }
  const promptMatch = rest.match(/<!--\s*prompt:\n([\s\S]*?)\n-->/);
  const prompt = promptMatch ? promptMatch[1].trim() : "";
  const caption = rest.replace(/<!--\s*prompt:[\s\S]*?-->/, "").trim();
  const required = ["date", "agent", "title", "image", "image_model", "caption_model", "provider", "prompt_hash", "generated_at"];
  for (const k of required) {
    if (!(k in meta)) throw new Error(`dream markdown: missing field ${k}`);
  }
  return {
    meta: meta as unknown as DreamMetadata,
    caption,
    prompt,
  };
}
