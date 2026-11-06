-- Match the storage limits to what the app tells people:
--   attachments: 25 MB (the app allows 25 MB files; the bucket was capped at 5 MB, so 5–25 MB
--   files passed the app's check and then failed at upload). Images are still held to 5 MB by
--   the app, after being shrunk in the browser.
--   avatars / server-icons: 5 MB (the app's image limit; the buckets were capped at 2 MB, so
--   large animated GIF avatars failed with a confusing storage error).
update storage.buckets set file_size_limit = 26214400 where id = 'attachments';
update storage.buckets set file_size_limit = 5242880 where id in ('avatars', 'server-icons');
