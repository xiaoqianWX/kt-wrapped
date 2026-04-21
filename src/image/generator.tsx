import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { WrappedTemplate } from "./template";
import type { CodexStats } from "../types";
import { loadFonts } from "./fonts";
import { layout } from "./design-tokens";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface GeneratedImage {
  /** Full resolution PNG buffer for saving/clipboard */
  fullSize: Buffer;
  /** Scaled PNG buffer for terminal display (80% of full size) */
  displaySize: Buffer;
}

export async function generateImage(stats: CodexStats): Promise<GeneratedImage> {
  await initWasm(Bun.file(resvgWasm).arrayBuffer());
  const logoDataUrl = await loadLogoDataUrl();

  const svg = await satori(<WrappedTemplate stats={stats} logoDataUrl={logoDataUrl} />, {
    width: layout.canvas.width,
    height: layout.canvas.height,
    fonts: await loadFonts(),
  });

  const [fullSize, displaySize] = [1, 0.75].map((v) => {
    const resvg = new Resvg(svg, {
      fitTo: {
        mode: "zoom",
        value: v,
      },
    });
    return Buffer.from(resvg.render().asPng());
  });

  return { fullSize, displaySize };
}

const DEFAULT_LOGO_CANDIDATES = [
  process.env.KT_WRAPPED_LOGO,
  fileURLToPath(
    new URL("../../../KohakuTerrarium/src/kohakuterrarium/web_dist/kohaku-icon.png", import.meta.url)
  ),
  fileURLToPath(
    new URL("../../../KohakuTerrarium/src/kohakuterrarium/app_icon.png", import.meta.url)
  ),
].filter((value): value is string => Boolean(value));

async function loadLogoDataUrl(): Promise<string> {
  for (const candidate of DEFAULT_LOGO_CANDIDATES) {
    try {
      const bytes = await readFile(candidate);
      return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      // Try the next candidate.
    }
  }

  return buildFallbackLogoDataUrl();
}

function buildFallbackLogoDataUrl(): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="28" fill="#16211D"/>
      <rect x="10" y="10" width="108" height="108" rx="22" fill="#22352D" stroke="#D8A14C" stroke-width="4"/>
      <text x="64" y="76" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="44" font-weight="700" fill="#EEF6EF">KT</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
