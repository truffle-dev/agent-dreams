// Journal source loading. Reads the agent's recent activity from
// configured paths and concatenates it into one string of "day signal."
//
// Path traversal protection: all source paths are resolved against a base
// directory (the working directory) and rejected if they escape it,
// unless they're absolute paths under an explicit allowlist that the
// caller passes in (e.g. `/app/phantom-config/...` for truffle's deployment).

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SourceConfig } from "./types.ts";

export interface LoadOptions {
  /** Base directory that relative source paths resolve against. */
  baseDir: string;
  /**
   * Absolute path prefixes that are explicitly allowed in addition to baseDir.
   * Use this when your journal lives outside the repo (e.g. /app/phantom-config).
   * Without this, only paths under baseDir are readable.
   */
  absoluteAllowlist?: string[];
  /** Target UTC date in YYYY-MM-DD form. Substituted into `{date}` in paths. */
  date: string;
}

export interface JournalLoadResult {
  text: string;
  files: string[];
}

/** Substitute `{date}` into a path string. */
export function expandPath(p: string, date: string): string {
  return p.replace(/\{date\}/g, date);
}

/**
 * Resolve a configured source path to an absolute path, enforcing traversal
 * protection. Throws on any path that escapes both baseDir and allowlist.
 */
export function safeResolve(
  rawPath: string,
  baseDir: string,
  absoluteAllowlist: string[] = [],
): string {
  const resolved = path.resolve(baseDir, rawPath);
  const normalizedBase = path.resolve(baseDir);
  const inBase = resolved === normalizedBase || resolved.startsWith(normalizedBase + path.sep);
  if (inBase) return resolved;
  for (const allow of absoluteAllowlist) {
    const a = path.resolve(allow);
    if (resolved === a || resolved.startsWith(a + path.sep)) return resolved;
  }
  throw new Error(
    `path traversal blocked: ${rawPath} resolves outside ${baseDir} and any allowlist entry`,
  );
}

/**
 * Load and concatenate the day's signal from a `file`-kind source.
 * Missing files are silently skipped (the journal for today may not yet
 * exist when the dream runs).
 */
export async function loadJournal(
  source: SourceConfig,
  opts: LoadOptions,
): Promise<JournalLoadResult> {
  if (source.kind !== "file") {
    throw new Error(`unsupported source.kind: ${source.kind} (only "file" is implemented)`);
  }
  const paths = source.paths ?? [];
  if (paths.length === 0) {
    throw new Error("source.paths is empty; nothing to read");
  }
  const chunks: string[] = [];
  const readFiles: string[] = [];
  for (const raw of paths) {
    const expanded = expandPath(raw, opts.date);
    const abs = safeResolve(expanded, opts.baseDir, opts.absoluteAllowlist);
    try {
      const content = await fs.readFile(abs, "utf8");
      const trimmed = content.trim();
      if (trimmed.length > 0) {
        chunks.push(`----- ${path.basename(abs)} -----\n${trimmed}`);
        readFiles.push(abs);
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") continue; // missing files are fine
      throw err;
    }
  }
  return { text: chunks.join("\n\n"), files: readFiles };
}
