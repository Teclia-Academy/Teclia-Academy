# Local uploads mode

## Cómo activar modo local

Set `LOCAL_UPLOADS=true` in your environment before starting the backend.

Also set `MEDIA_SIGNING_SECRET` to a long random value. Paid content receives an HMAC-signed URL whose lifetime is controlled by `CONTENT_SIGNED_URL_TTL_SECONDS` (900 seconds by default, constrained to 300-900 seconds).

## Cómo volver a Supabase

Set `LOCAL_UPLOADS=false` (or remove the variable) and make sure your Supabase credentials are present.

For Vercel, configure these environment variables:

- `DATABASE_URL`: the PostgreSQL connection string used by Prisma migrations and the API.
- `SUPABASE_URL`: the full project URL, for example `https://your-project.supabase.co`.
- `SUPABASE_SERVICE_KEY`: the server-only service role key. Never expose it as a `VITE_` variable.
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`: the project's public key, used for signed browser uploads.
- `SUPABASE_BUCKET`: an existing bucket; defaults to `uploads`.
- `LOCAL_UPLOADS`: set to `false` or leave unset.

The bucket must allow public reads for free content; paid content continues to use short-lived signed URLs. Increase the bucket's file-size limit and allowed MIME types to support the video sizes and formats you intend to upload; Supabase plan limits still apply.

Files larger than 4 MB are sent directly from the browser to Supabase using resumable TUS uploads, avoiding Vercel's function request-size limit. Smaller files continue to use the existing API upload.

## Estructura de carpetas

The backend stores files under:

- `Backend/uploads/<subfolder>/<filename>` for local mode

## Limitaciones

- Free content remains public after the backend confirms that its database record is free.
- Paid content is served only through `/api/media/signed`; direct `/uploads/content/*` access is blocked.
- A signed URL is a bearer credential and can be shared until it expires. It does not encrypt file bytes or provide offline caching.
- This mode is intended for local development and small test environments.

## Ejemplos

### Upload

```js
const storagePath = await storage.upload(req.file, 'courses');
```

### Retrieval

```js
const url = storage.resolveUrl(storagePath);
```

### Signed retrieval

```js
const url = await storage.resolveSignedUrl(storagePath, {
  expiresInSeconds: 900,
});
```

### Delete

```js
await storage.delete(storagePath);
```
