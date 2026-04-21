// Provider interfaces. Two methods, three implementations, one registry.

export interface ImageGenerateOptions {
  model?: string;
  quality?: "low" | "medium" | "high";
  size?: "1024x1024";
}

export interface CaptionGenerateOptions {
  model?: string;
  maxWords?: number;
}

export interface ImageResult {
  bytes: Uint8Array;
  mime: string;
  model: string;
}

export interface CaptionResult {
  text: string;
  model: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(prompt: string, opts?: ImageGenerateOptions): Promise<ImageResult>;
}

export interface CaptionProvider {
  readonly name: string;
  caption(prompt: string, opts?: CaptionGenerateOptions): Promise<CaptionResult>;
}

// A combined provider exposes both. Implementations may share a client.
export interface DreamProvider extends ImageProvider, CaptionProvider {
  readonly name: string;
}
