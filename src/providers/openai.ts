// OpenAI provider. Image: gpt-image-1. Caption: gpt-4o-mini.
//
// Standalone client (does not depend on the truffle MCP tool) so that
// adopters who fork this repo only need an OPENAI_API_KEY.

import OpenAI from "openai";
import type {
  CaptionGenerateOptions,
  CaptionResult,
  DreamProvider,
  ImageGenerateOptions,
  ImageResult,
} from "./types.ts";

export interface OpenAIProviderOptions {
  apiKey: string;
  imageModel?: string;
  imageQuality?: "low" | "medium" | "high";
  captionModel?: string;
}

export class OpenAIProvider implements DreamProvider {
  readonly name = "openai";
  private client: OpenAI;
  private imageModel: string;
  private imageQuality: "low" | "medium" | "high";
  private captionModel: string;

  constructor(opts: OpenAIProviderOptions) {
    if (!opts.apiKey) {
      throw new Error("OpenAIProvider: apiKey is required");
    }
    this.client = new OpenAI({ apiKey: opts.apiKey, timeout: 90_000 });
    this.imageModel = opts.imageModel ?? "gpt-image-1";
    this.imageQuality = opts.imageQuality ?? "medium";
    this.captionModel = opts.captionModel ?? "gpt-4o-mini";
  }

  async generate(prompt: string, opts?: ImageGenerateOptions): Promise<ImageResult> {
    const model = opts?.model ?? this.imageModel;
    const quality = opts?.quality ?? this.imageQuality;
    const size = opts?.size ?? "1024x1024";

    // gpt-image-1 uses low|medium|high for quality; the SDK's types still
    // reflect DALL-E 3's "standard"|"hd" enum. Cast to pass through.
    const resp = await this.client.images.generate({
      model,
      prompt,
      size,
      quality: quality as unknown as "standard" | "hd",
      n: 1,
    });

    const data = resp.data?.[0];
    if (!data?.b64_json) {
      throw new Error("OpenAIProvider.generate: response missing b64_json image data");
    }
    const bytes = Uint8Array.from(Buffer.from(data.b64_json, "base64"));
    return { bytes, mime: "image/png", model };
  }

  async caption(prompt: string, opts?: CaptionGenerateOptions): Promise<CaptionResult> {
    const model = opts?.model ?? this.captionModel;
    const resp = await this.client.chat.completions.create({
      model,
      messages: [
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 600,
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("OpenAIProvider.caption: response missing message content");
    }
    return { text, model };
  }
}
