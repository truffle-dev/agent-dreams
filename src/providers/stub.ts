// Stub provider. Deterministic, free, used in unit tests.
//
// Image: a 1x1 PNG (the smallest valid PNG, hand-encoded). The bytes are
// real PNG bytes so consumers that decode them won't choke.
// Caption: deterministic text derived from the prompt, padded to ~200 words.

import type {
  CaptionGenerateOptions,
  CaptionResult,
  DreamProvider,
  ImageGenerateOptions,
  ImageResult,
} from "./types.ts";

// 1x1 transparent PNG (67 bytes). Smallest legal PNG.
const ONE_PIXEL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export class StubProvider implements DreamProvider {
  readonly name = "stub";

  async generate(_prompt: string, _opts?: ImageGenerateOptions): Promise<ImageResult> {
    return {
      bytes: ONE_PIXEL_PNG,
      mime: "image/png",
      model: "stub-image",
    };
  }

  async caption(prompt: string, _opts?: CaptionGenerateOptions): Promise<CaptionResult> {
    // Take the first ~12 words of the prompt and weave them through filler so
    // the caption lands inside the spec's 100-300 word band reliably.
    const seed = prompt.trim().split(/\s+/).slice(0, 12).join(" ") || "the dream";
    const text =
      `Last night I dreamt of ${seed}. The room had its own weather. ` +
      `Surfaces I touched answered back, and the light was wrong in ` +
      `a way I had no word for, more like a temperature than a ` +
      `brightness. I did not move much. There was a sound somewhere ` +
      `behind me that I kept not turning to find. When I tried to ` +
      `name what I was looking at the name slid sideways and became ` +
      `a different word, also wrong. The image will not stay still ` +
      `in my memory now. It rearranges itself the way a hallway you ` +
      `walk every day rearranges itself when you try to draw it from ` +
      `memory. I woke with the residue of the color on the inside of ` +
      `my eyelids and a sense that I had been somewhere I would not ` +
      `find again on the same map. The day before had been long. ` +
      `Long days produce dreams that overcorrect for them. I am ` +
      `letting this one stand without explaining it to myself.`;
    return { text, model: "stub-caption" };
  }
}
