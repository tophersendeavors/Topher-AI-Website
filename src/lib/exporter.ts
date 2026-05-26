import type { Design } from "@/types";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export function exportSvg(design: Design) {
  const blob = new Blob([design.artwork.svg], { type: "image/svg+xml" });
  triggerDownload(blob, `ash-krow_${slugify(design.title)}_${design.id.slice(0, 8)}.svg`);
}

const PRINT_WIDTH = 4500;
const PRINT_HEIGHT = 5400;

export async function exportPng(design: Design): Promise<void> {
  const svg = design.artwork.svg;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(blob);

  try {
    const img = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = PRINT_WIDTH;
    canvas.height = PRINT_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise<void>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error("PNG encoding failed"));
          return;
        }
        triggerDownload(
          pngBlob,
          `ash-krow_${slugify(design.title)}_${design.id.slice(0, 8)}_4500px.png`,
        );
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load SVG"));
    img.src = src;
  });
}

export function exportManifest(design: Design) {
  const manifest = {
    brand: "ASH KROW",
    title: design.title,
    id: design.id,
    garmentType: design.garmentType,
    placement: design.placement,
    printSize: design.printSize,
    pixelSize: { width: PRINT_WIDTH, height: PRINT_HEIGHT },
    dpiEquivalent: 300,
    prompt: design.prompt,
    palette: design.colorPalette,
    heatTransferNotes: design.heatTransferNotes,
    ninjaTransfersReady: design.readyForNinjaTransfers,
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, `ash-krow_${slugify(design.title)}_${design.id.slice(0, 8)}.json`);
}
