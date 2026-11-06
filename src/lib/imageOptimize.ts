import { planImage, renameForType, shouldUseEncoded } from "@/lib/imagePlan";

const QUALITY = 0.85;

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Resize and re-save an image in the browser before upload, per the rules in imagePlan.ts.
 * Re-saving drops EXIF metadata (including GPS location); the photo's rotation is applied to the
 * pixels first ("from-image"), so stripping EXIF doesn't leave portrait phone photos sideways.
 * Never throws: on any failure (unsupported browser, undecodable file) it returns the original,
 * which then goes through the normal size/type checks.
 */
export async function optimizeImage(file: File, maxDim: number): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const plan = planImage({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height }, maxDim);
    if (plan.action === "keep") return file;

    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);

    // WebP keeps transparency and is much smaller. Browsers that can't encode it silently hand back
    // a PNG instead, so check the type and fall back: PNG for PNGs (keep transparency), else JPEG.
    let blob = await toBlob(canvas, "image/webp");
    if (!blob || blob.type !== "image/webp") {
      blob = await toBlob(canvas, file.type === "image/png" ? "image/png" : "image/jpeg");
    }
    if (!blob || !shouldUseEncoded({ srcType: file.type, srcSize: file.size, outSize: blob.size })) return file;
    return new File([blob], renameForType(file.name, blob.type), { type: blob.type, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
