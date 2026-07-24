-- The `attachments` bucket was originally created (out-of-band) with an image-only
-- allowed_mime_types list. Arbitrary file uploads are stored as application/octet-stream
-- (forced, to avoid stored-XSS from a public bucket serving client-declared types), so the
-- bucket must accept them. Remove the MIME restriction (public read stays; the octet-stream
-- content-type prevents inline execution of uploaded HTML/SVG).
update storage.buckets set allowed_mime_types = null where id = 'attachments';
