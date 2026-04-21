#!/usr/bin/env bun
// agent-dreams CLI. Hand-rolled argv parsing — three verbs, lean deps.
//
//   agent-dreams generate [--date YYYY-MM-DD] [--config ./config.yaml]
//   agent-dreams render-site [--config ./config.yaml]
//   agent-dreams init

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "yaml";
import type { Config } from "./types.ts";
import type { DreamProvider } from "./providers/types.ts";
import { generateDream, EmptyJournalError, NoDreamError } from "./dream.ts";
import { renderSite } from "./site.ts";
import { StubProvider } from "./providers/stub.ts";
import { OpenAIProvider } from "./providers/openai.ts";
import { ReplicateProvider } from "./providers/replicate.ts";

interface ParsedArgs {
  verb: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [verb = "", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { verb, flags, positional };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadConfig(file: string): Promise<Config> {
  const raw = await fs.readFile(file, "utf8");
  const parsed = YAML.parse(raw) as Config;
  if (!parsed?.agent?.name) throw new Error(`config ${file}: agent.name is required`);
  if (!parsed?.source?.kind) throw new Error(`config ${file}: source.kind is required`);
  if (!parsed?.provider?.kind) throw new Error(`config ${file}: provider.kind is required`);
  if (!parsed?.output?.dir) throw new Error(`config ${file}: output.dir is required`);
  if (!parsed?.output?.site_dir) throw new Error(`config ${file}: output.site_dir is required`);
  return parsed;
}

function buildProvider(config: Config): DreamProvider {
  const kind = config.provider.kind;
  if (kind === "stub") return new StubProvider();
  if (kind === "openai") {
    const envName = config.provider.api_key_env ?? "OPENAI_API_KEY";
    const key = process.env[envName];
    if (!key) throw new Error(`provider openai: env var ${envName} is not set`);
    return new OpenAIProvider({
      apiKey: key,
      imageModel: config.provider.image_model,
      imageQuality: config.provider.image_quality,
      captionModel: config.provider.caption_model,
    });
  }
  if (kind === "replicate") {
    const envName = config.provider.api_key_env ?? "REPLICATE_API_TOKEN";
    const token = process.env[envName];
    if (!token) throw new Error(`provider replicate: env var ${envName} is not set`);
    return new ReplicateProvider({
      apiToken: token,
      imageModel: config.provider.image_model,
      captionModel: config.provider.caption_model,
    });
  }
  throw new Error(`unknown provider kind: ${kind}`);
}

const HELP = `agent-dreams — one image, one caption, every night.

Usage:
  agent-dreams generate [--date YYYY-MM-DD] [--config ./config.yaml] [--allow PATH]...
  agent-dreams render-site [--config ./config.yaml]
  agent-dreams init

Flags:
  --date     UTC date for the dream. Defaults to today.
  --config   Path to config file. Defaults to ./config.yaml.
  --allow    Absolute path prefix to allow as a journal source. Repeatable.
             Use this when your journal lives outside the working directory
             (e.g. --allow /app/phantom-config).
`;

async function cmdInit(): Promise<number> {
  const here = process.cwd();
  const example = path.join(here, "config.example.yaml");
  const target = path.join(here, "config.yaml");
  try {
    await fs.access(target);
    console.error(`config.yaml already exists at ${target}; not overwriting`);
    return 1;
  } catch {
    // doesn't exist, good
  }
  const content = await fs.readFile(example, "utf8");
  await fs.writeFile(target, content);
  console.log(`wrote ${target}`);
  console.log("edit it to point at your journal source and provider, then run: bun run generate");
  return 0;
}

async function cmdGenerate(args: ParsedArgs): Promise<number> {
  const date = (args.flags.date as string | undefined) ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date must be YYYY-MM-DD, got ${date}`);
    return 2;
  }
  const configPath = (args.flags.config as string | undefined) ?? "./config.yaml";
  const config = await loadConfig(configPath);

  const allow = args.flags.allow;
  const absoluteAllowlist: string[] = Array.isArray(allow)
    ? allow as string[]
    : typeof allow === "string"
      ? [allow]
      : [];

  const baseDir = process.cwd();
  const templatesDir = path.resolve(import.meta.dir, "..", "templates");
  const provider = buildProvider(config);

  console.log(`generating dream for ${config.agent.name} on ${date} via ${provider.name}`);
  try {
    const result = await generateDream({
      config,
      date,
      provider,
      baseDir,
      absoluteAllowlist,
      templatesDir,
    });
    console.log(`image:   ${result.dream.imagePath}`);
    console.log(`caption: ${result.dream.metaPath}`);
    console.log(`title:   ${result.dream.meta.title}`);
    return 0;
  } catch (err) {
    if (err instanceof EmptyJournalError) {
      console.error(`no dream tonight: ${err.message}`);
      return 3;
    }
    if (err instanceof NoDreamError) {
      console.error(`no dream tonight: ${err.message}`);
      return 3;
    }
    throw err;
  }
}

async function cmdRenderSite(args: ParsedArgs): Promise<number> {
  const configPath = (args.flags.config as string | undefined) ?? "./config.yaml";
  const config = await loadConfig(configPath);
  const baseDir = process.cwd();
  const templatesDir = path.resolve(import.meta.dir, "..", "templates");
  const result = await renderSite({ config, baseDir, templatesDir });
  console.log(`rendered ${result.count} dream(s) to ${result.siteDir}`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.verb || args.flags.help || args.verb === "help" || args.verb === "--help") {
    console.log(HELP);
    return args.verb ? 0 : 1;
  }
  switch (args.verb) {
    case "generate":     return cmdGenerate(args);
    case "render-site":  return cmdRenderSite(args);
    case "init":         return cmdInit();
    default:
      console.error(`unknown verb: ${args.verb}\n`);
      console.error(HELP);
      return 2;
  }
}

if (import.meta.main) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack && process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
