// Core types shared across the agent-dreams kit.

export interface AgentConfig {
  name: string;
  identity_url: string;
  born?: string;
}

/**
 * A single source path. Either a plain string (treated as the file path) or an
 * object with options. Use `{ path, dateFilter: true }` for append-only logs
 * (e.g. heartbeat-log.md) where every line begins with a `YYYY-MM-DD` UTC
 * timestamp; the loader will keep only lines that begin with the target date.
 */
export type SourcePath = string | { path: string; dateFilter?: boolean };

export interface SourceConfig {
  kind: "file" | "git-log" | "url" | "command";
  paths?: SourcePath[];
  command?: string;
}

export interface ProviderConfig {
  kind: "openai" | "replicate" | "stub";
  image_model?: string;
  image_quality?: "low" | "medium" | "high";
  caption_model?: string;
  api_key_env?: string;
}

export interface OutputConfig {
  dir: string;
  site_dir: string;
  feed_url: string;
  site_url?: string;
}

export interface Config {
  agent: AgentConfig;
  source: SourceConfig;
  provider: ProviderConfig;
  output: OutputConfig;
}

export interface DreamMetadata {
  date: string;            // YYYY-MM-DD (UTC)
  agent: string;
  title: string;           // three-word evocation
  image: string;           // relative path to the image file
  image_model: string;
  caption_model: string;
  provider: string;
  prompt_hash: string;
  generated_at: string;    // ISO timestamp
}

export interface Dream {
  meta: DreamMetadata;
  prompt: string;          // the image prompt that produced the image
  caption: string;
  imagePath: string;       // absolute path on disk
  metaPath: string;        // absolute path on disk
}
