# Composer redesign + file upload + emoji picker — design

**Date:** 2026-07-10
**Sub-project:** UI/messaging batch, slice A of 5 (then B dropdowns, C status bubble, D roles, E settings)
**Status:** approved, ready for planning

## Goal

Rework the message composer into one unified Discord-like input bar: a rounded **+**
button (upload menu) and an **emoji picker** live inside the same bar as a taller textarea.
Support uploading **any file type** (images inline, other files as a download card), via the
+ menu **or drag-and-drop**.

## Decisions (from brainstorming)

- One unified rounded input bar containing `+` (left), textarea (middle, taller), emoji
  button (right). The old standalone 📎 button is removed.
- `+` opens a small popover menu with **"Upload a file"** (file icon). Only item for now
  (threads/polls will be added here later).
- **Any file type**: images render inline (existing `image_url` path); non-images post as a
  **download card** (icon + filename). ~25 MB cap.
- **Drag-and-drop** a file onto the composer uploads it (same path as the + menu), with a
  "Drop to upload" overlay while dragging.
- **Emoji picker** via the `emoji-picker-react` library; clicking inserts the emoji at the
  caret.

## Current state

`src/components/messages/MessageInput.tsx`: a 📎 button (image-only via `uploadImage`) beside
a 1-row `rounded-2xl` textarea; `onPickFile` uploads then posts an optimistic message with
`image_url`. `uploadImage` (`src/lib/upload.ts`) is image-only (`ALLOWED` MIME, ≤5 MB) to the
`attachments` bucket. `messages` has `image_url`; `MessageContent` renders it inline (http(s)
only). The messages CHECK constraint is `char_length(content) > 0 or image_url is not null`.

## Data model — `supabase/migrations/0010_file_attachments.sql`

```sql
alter table public.messages add column if not exists file_url text;
alter table public.messages add column if not exists file_name text;

-- widen the existing "non-empty" check (named messages_nonempty in 0002) to allow a file
alter table public.messages drop constraint if exists messages_nonempty;
alter table public.messages add constraint messages_nonempty
  check (char_length(content) > 0 or image_url is not null or file_url is not null);
```
(The `messages_content_len` ≤2000 constraint from 0002 is unrelated and stays.) `Message`
type gains `file_url: string | null` and `file_name: string | null`.

## Upload — `src/lib/upload.ts`

- Add `const FILE_MAX_BYTES = 25 * 1024 * 1024;`
- `export function isImageType(type: string): boolean` — true for the existing image MIME set
  (pure, tested).
- `export async function uploadFile(file: File): Promise<{ url: string; name: string } | { error: string }>`
  — size check (≤25 MB); upload to the `attachments` bucket with the original `contentType`;
  return the public URL and the original `file.name`. (Reuses the UUID-path pattern.)

## Composer — `src/components/messages/MessageInput.tsx`

- **One shared `handleFile(file: File)`** used by the + menu, the file input, and drop.
  If `isImageType(file.type)` → existing image path (posts message with `image_url`); else →
  `uploadFile` → posts message with `file_url` + `file_name`. Both keep the optimistic-send +
  reply-fields behavior. `Message` optimistic objects include the new fields.
- **Layout:** replace the current 📎+textarea row with one bar:
  `flex items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2`, containing:
  - a rounded `+` button (`rounded-full`/`rounded-lg`, hover states) that toggles the upload
    menu;
  - the textarea: `flex-1 bg-transparent outline-none resize-none` with a **taller**
    min-height (e.g. `min-h-[44px]`) that auto-grows to a max; no own border/rounding (the
    bar provides it);
  - a 🙂 emoji button on the right that toggles the picker.
- **Upload menu:** a small popover above the `+` button — one row "Upload a file" with a file
  icon; clicking it opens the hidden `<input type="file">` (now `accept="*/*"`).
- **Drag-and-drop:** on the composer container, `onDragOver`/`onDragLeave`/`onDrop` set a
  `dragging` flag and, on drop, call `handleFile(e.dataTransfer.files[0])` (first file).
  While `dragging`, show a "Drop to upload" overlay covering the bar.
- Keep the existing @-mention autocomplete, reply bar, Enter-to-send, and caret tracking.

## Emoji picker

- Add dependency `emoji-picker-react`.
- The 🙂 button toggles a picker popover positioned above the button. Use its dark theme.
- On select, insert the emoji at the caret using the existing caret logic (mirror
  `pickMention`: splice at `caret`, restore focus/selection). Close the picker after insert
  (or keep open — pick one; default: keep open so multiple emojis can be added, close on
  outside-click/Escape).

## Rendering — `src/components/messages/MessageContent.tsx`

Add a **download card** when `msg.file_url` is set (and is an http(s) URL, same guard as
images): a bordered rounded row with a file/📄 icon + `msg.file_name` (fallback "file"),
wrapped in an `<a href={file_url} download target="_blank" rel="noopener noreferrer">`. Images
(`image_url`) keep rendering inline as today. A message may have text + an attachment.

## Non-goals (YAGNI)

- No multi-file drop (first file only for now).
- No threads/polls in the + menu yet (later slices).
- No image thumbnails/previews for non-image files (just the download card).
- No server-side MIME/type enforcement — client-checked, consistent with existing uploads
  (trusted friend group).

## Testing

- **Unit:** `isImageType` (image MIME → true; pdf/other → false) in `tests/upload.test.ts`
  (extend the existing file). Any pure emoji-caret-insert helper extracted also gets a test.
- **Backend smoke** (live DB, throwaway users): upload a non-image file via `uploadFile`,
  insert a message with `file_url`/`file_name`, confirm a second user can read that message
  and the file URL resolves (HTTP 200).
- `npx vitest run` stays green; `npm run build` clean.

## Operational notes

- Run `0010_file_attachments.sql` in the Supabase SQL editor.
- Confirm the `attachments` storage bucket accepts non-image content types (if it was created
  with an `allowed_mime_types` restriction, remove it so PDFs/docs upload).
- `emoji-picker-react` must be installed (`npm install emoji-picker-react`).
