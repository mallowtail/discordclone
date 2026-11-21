"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { optimizeImage } from "@/lib/media/imageOptimize";
import { uploadFailureMessage, uploadLimitProblem } from "@/lib/media/upload";
import {
  MAX_STICKERS, STICKER_MAX_BYTES, STICKER_STATIC_MAX, checkStickerFile, checkStickerSource, cleanStickerName, defaultStickerName,
  fitSticker, isAnimatedImage, stickerExt, stickerPublicUrl, type Sticker,
} from "@/lib/messages/stickers";

const field = "w-full rounded-control bg-surface-2 border border-line px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-60";

/** Turn a database error into the message shown to the admin. */
function dbError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "A sticker with that name already exists";
  if (error.message?.includes("sticker limit reached")) return `This server already has ${MAX_STICKERS} stickers`;
  return "Couldn't save the sticker — try again";
}

async function readSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return null;
  }
}

const UNSUPPORTED = "This photo type isn't supported — save it as JPG or PNG first";

/** Decode any picture the browser understands (SVG goes through an <img>). */
async function decodeImage(file: File): Promise<{ src: CanvasImageSource; width: number; height: number; close: () => void } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bmp.width > 0 && bmp.height > 0) return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    bmp.close();
  } catch { /* fall through to <img> */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // SVGs without a fixed size report 0; draw them at the sticker size.
    const width = img.naturalWidth || STICKER_STATIC_MAX, height = img.naturalHeight || STICKER_STATIC_MAX;
    return { src: img, width, height, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/** Draw a picture to a canvas at most STICKER_STATIC_MAX on the long side and save it as WebP (PNG if WebP isn't available). Never JPEG, so transparency survives. */
async function toStickerImage(file: File): Promise<File | null> {
  const dec = await decodeImage(file);
  if (!dec) return null;
  try {
    const scale = Math.min(1, STICKER_STATIC_MAX / Math.max(dec.width, dec.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(dec.width * scale));
    canvas.height = Math.max(1, Math.round(dec.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(dec.src, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
    let blob = await encode("image/webp");
    if (!blob || blob.type !== "image/webp") blob = await encode("image/png");
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/png")) return null;
    const ext = stickerExt(blob.type);
    return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "sticker"}.${ext}`, { type: blob.type });
  } catch {
    return null;
  } finally {
    dec.close();
  }
}

type Pending = { file: File; previewUrl: string; name: string };

/** Settings → Stickers: upload, rename and delete the server's stickers. */
export function StickersTab({ serverId }: { serverId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Sticker | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from("stickers").select("*").eq("server_id", serverId).order("created_at", { ascending: true });
    if (err) {
      // Don't show a stale or empty list (and keep Upload disabled) until a load succeeds.
      setStickers(null);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setStickers((data as Sticker[] | null) ?? []);
  }, [supabase, serverId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the sticker list
    load();
  }, [load]);

  // Free the preview's object URL when it changes or the tab closes.
  useEffect(() => {
    const url = pending?.previewUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [pending?.previewUrl]);

  const count = stickers?.length ?? 0;
  const full = count >= MAX_STICKERS;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setError(null);
    const srcErr = checkStickerSource(picked);
    if (srcErr) return setError(srcErr);
    let file = picked;
    if (!stickerExt(picked.type)) {
      // JPEG, HEIC, AVIF, BMP, SVG…: converted to a small WebP/PNG here, since only those are stored.
      const converted = await toStickerImage(picked);
      if (!converted) return setError(UNSUPPORTED);
      file = converted;
    }
    else {
      // Static images that are too wide/tall or over 512 KB are re-encoded to PNG/WebP (keeps
      // transparency, never JPEG); animated files are never re-encoded. The size is re-checked below.
      const animated = isAnimatedImage(new Uint8Array(await picked.arrayBuffer()), picked.type);
      if (!animated) {
        const out = await optimizeImage(picked, STICKER_STATIC_MAX, { reencodeAboveBytes: STICKER_MAX_BYTES, noJpeg: true });
        if (out.type === "image/png" || out.type === "image/webp") file = out;
      }
    }
    const err = checkStickerFile(file);
    if (err) return setError(err);
    setPending({ file, previewUrl: URL.createObjectURL(file), name: defaultStickerName(picked.name) });
  }

  async function save() {
    if (!pending || busy) return;
    const cleaned = cleanStickerName(pending.name);
    if (!cleaned.ok) return setError(cleaned.error);
    const ext = stickerExt(pending.file.type);
    if (!ext) return setError("Stickers must be PNG, GIF or WebP");
    setBusy(true);
    setError(null);
    const size = await readSize(pending.file);
    if (!size) {
      setBusy(false);
      return setError("Couldn't read that image");
    }
    // Stickers count toward the uploader's 20 MB a day and stop when storage is almost full.
    const blocked = await uploadLimitProblem();
    if (blocked) {
      setBusy(false);
      return setError(blocked);
    }
    const path = `${serverId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("stickers").upload(path, pending.file, {
      cacheControl: "60", contentType: pending.file.type, upsert: false,
    });
    if (up.error) {
      const text = await uploadFailureMessage("Couldn't upload the sticker — try again");
      setBusy(false);
      return setError(text);
    }
    const { error: insErr } = await supabase.from("stickers")
      .insert({ server_id: serverId, name: cleaned.name, path, width: size.width, height: size.height });
    if (insErr) {
      await supabase.storage.from("stickers").remove([path]);
      setBusy(false);
      return setError(dbError(insErr));
    }
    setBusy(false);
    setPending(null);
    load();
  }

  async function rename() {
    if (!editing) return;
    const cleaned = cleanStickerName(editing.name);
    if (!cleaned.ok) return setError(cleaned.error);
    const current = stickers?.find((s) => s.id === editing.id);
    if (current && current.name === cleaned.name) return setEditing(null);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("stickers").update({ name: cleaned.name }).eq("id", editing.id);
    setBusy(false);
    if (err) return setError(dbError(err));
    setEditing(null);
    load();
  }

  async function remove(s: Sticker) {
    setDeleting(null);
    setBusy(true);
    setError(null);
    // `.select()` returns the deleted rows: none means the database filtered it out (no permission,
    // or a banned account), so the file must stay too.
    const { data: gone, error: err } = await supabase.from("stickers").delete().eq("id", s.id).select("id");
    if (err || !gone?.length) {
      setBusy(false);
      return setError("Couldn't delete the sticker — try again");
    }
    await supabase.storage.from("stickers").remove([s.path]);
    setBusy(false);
    load();
  }

  return (
    <>
      <div className="mb-5 pr-12 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-ink tracking-tight">
            Stickers <span className="text-meta font-normal text-muted">{count} / {MAX_STICKERS}</span>
          </h2>
          <p className="mt-1 text-meta text-muted">Any picture works; it&apos;s shrunk to fit (animated GIFs must be 512 KB or smaller). Anyone in the server can send them.</p>
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || full || !!pending || stickers === null}
          title={full ? `This server already has ${MAX_STICKERS} stickers` : undefined}
          className="flex-none rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-4 py-2 disabled:opacity-50">
          Upload
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>

      {error && <p role="alert" className="mb-3 text-meta text-danger">{error}</p>}

      {pending && (
        <div className="mb-5 flex items-center gap-4 border border-line rounded-card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={pending.previewUrl} alt="" className="w-20 h-20 flex-none object-contain" />
          <div className="min-w-0 flex-1">
            <label className="block text-meta font-medium text-muted mb-1" htmlFor="sticker-name">Sticker name</label>
            <input id="sticker-name" value={pending.name} autoFocus disabled={busy} className={field}
              onChange={(e) => { setPending({ ...pending, name: e.target.value }); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                // Cancel the upload instead of letting Escape close all of Server Settings.
                if (e.key === "Escape") { e.stopPropagation(); if (!busy) { setPending(null); setError(null); } }
              }} />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={save} disabled={busy}
                className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-4 py-1.5 disabled:opacity-50">
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => { setPending(null); setError(null); }} disabled={busy}
                className="rounded-control px-4 py-1.5 text-body font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {stickers === null ? (
        loadFailed ? (
          <p role="alert" className="text-body text-danger">
            Couldn&apos;t load stickers —{" "}
            <button type="button" onClick={() => { setLoadFailed(false); load(); }} className="underline hover:text-ink">try again</button>
          </p>
        ) : (
          <p className="text-body text-muted">Loading…</p>
        )
      ) : stickers.length === 0 ? (
        <p className="text-body text-muted">No stickers yet. Upload one to get started.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stickers.map((s) => {
            const { width, height } = fitSticker(s.width, s.height);
            const isEditing = editing?.id === s.id;
            return (
              <li key={s.id} className="border border-line rounded-card p-3 flex flex-col items-center gap-2">
                <div className="h-[160px] w-full flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded sticker */}
                  <img src={stickerPublicUrl(s.path)} alt={s.name} width={width} height={height} loading="lazy" />
                </div>
                {isEditing ? (
                  <div className="w-full">
                    <input value={editing.name} autoFocus aria-label="Sticker name" className={field} disabled={busy}
                      onChange={(e) => { setEditing({ id: s.id, name: e.target.value }); setError(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") { e.stopPropagation(); setEditing(null); setError(null); } }} />
                    <div className="mt-2 flex gap-2 justify-end">
                      <button type="button" onClick={() => { setEditing(null); setError(null); }} disabled={busy}
                        className="rounded-control px-3 py-1.5 text-meta text-ink hover:bg-surface-2">Cancel</button>
                      <button type="button" onClick={rename} disabled={busy}
                        className="rounded-control bg-accent hover:bg-accent-strong text-white text-meta font-medium px-3 py-1.5 disabled:opacity-50">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="w-full truncate text-center text-body text-ink">{s.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setEditing({ id: s.id, name: s.name }); setError(null); }} disabled={busy}
                        className="rounded-control border border-line px-3 py-1.5 text-meta text-ink hover:bg-surface-2 disabled:opacity-50">Rename</button>
                      <button type="button" onClick={() => setDeleting(s)} disabled={busy}
                        className="rounded-control border border-danger/50 px-3 py-1.5 text-meta text-danger hover:bg-danger/10 disabled:opacity-50">Delete</button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog title="Delete sticker" message={`Delete “${deleting.name}”? It'll show as “Sticker removed” everywhere it was sent.`}
          confirmLabel="Delete" destructive onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
