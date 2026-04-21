// Replicate provider. SDXL for the image, Llama-3 chat for the caption.
//
// Uses the Replicate HTTP API directly (no SDK dependency) to keep the
// dependency surface tiny. Adopters who want this provider need a
// REPLICATE_API_TOKEN.

import type {
  CaptionGenerateOptions,
  CaptionResult,
  DreamProvider,
  ImageGenerateOptions,
  ImageResult,
} from "./types.ts";

export interface ReplicateProviderOptions {
  apiToken: string;
  imageModel?: string;     // model:version slug, e.g. "stability-ai/sdxl:7762fd07..."
  captionModel?: string;   // e.g. "meta/meta-llama-3-8b-instruct"
}

interface PredictionResponse {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  urls?: { get: string };
}

const API = "https://api.replicate.com/v1";

export class ReplicateProvider implements DreamProvider {
  readonly name = "replicate";
  private token: string;
  private imageModel: string;
  private captionModel: string;

  constructor(opts: ReplicateProviderOptions) {
    if (!opts.apiToken) {
      throw new Error("ReplicateProvider: apiToken is required");
    }
    this.token = opts.apiToken;
    // SDXL pinned version. Override via config if you want a different model.
    this.imageModel =
      opts.imageModel ??
      "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc";
    this.captionModel = opts.captionModel ?? "meta/meta-llama-3-8b-instruct";
  }

  async generate(prompt: string, opts?: ImageGenerateOptions): Promise<ImageResult> {
    const [_modelName, version] = this.imageModel.split(":");
    if (!version) {
      throw new Error(
        `ReplicateProvider.generate: imageModel must be "owner/name:version", got ${this.imageModel}`,
      );
    }
    const pred = await this.createAndWait({
      version,
      input: { prompt, width: 1024, height: 1024, num_outputs: 1 },
    });
    const output = pred.output;
    const url = Array.isArray(output) ? String(output[0]) : String(output);
    if (!url || !url.startsWith("http")) {
      throw new Error(`ReplicateProvider.generate: unexpected output: ${JSON.stringify(output)}`);
    }
    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      throw new Error(`ReplicateProvider.generate: download failed (${imgResp.status})`);
    }
    const bytes = new Uint8Array(await imgResp.arrayBuffer());
    return { bytes, mime: "image/png", model: this.imageModel };
  }

  async caption(prompt: string, _opts?: CaptionGenerateOptions): Promise<CaptionResult> {
    const pred = await this.createAndWait({
      // Caption models on Replicate are typically "owner/name" without a
      // version pin; the official models endpoint resolves the latest.
      model: this.captionModel,
      input: { prompt, max_tokens: 600, temperature: 0.9 },
    });
    const out = pred.output;
    const text = (Array.isArray(out) ? out.join("") : String(out)).trim();
    if (!text) {
      throw new Error("ReplicateProvider.caption: empty output");
    }
    return { text, model: this.captionModel };
  }

  private async createAndWait(body: Record<string, unknown>): Promise<PredictionResponse> {
    const endpoint = "model" in body ? `${API}/models/${body.model}/predictions` : `${API}/predictions`;
    const initial = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify(body),
    });
    if (!initial.ok) {
      const text = await initial.text();
      throw new Error(`ReplicateProvider: create prediction failed (${initial.status}): ${text}`);
    }
    let pred = (await initial.json()) as PredictionResponse;

    // Poll until terminal. The Prefer: wait header above usually returns a
    // succeeded prediction directly, but image generation can take longer.
    const start = Date.now();
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
      if (Date.now() - start > 120_000) {
        throw new Error(`ReplicateProvider: timeout waiting for prediction ${pred.id}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
      const getUrl = pred.urls?.get;
      if (!getUrl) throw new Error("ReplicateProvider: missing urls.get on prediction");
      const r = await fetch(getUrl, { headers: { Authorization: `Bearer ${this.token}` } });
      pred = (await r.json()) as PredictionResponse;
    }
    if (pred.status !== "succeeded") {
      throw new Error(`ReplicateProvider: prediction ${pred.status}: ${pred.error ?? "(no error message)"}`);
    }
    return pred;
  }
}
