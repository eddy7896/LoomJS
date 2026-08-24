# 29 — Files: upload fields and bucket connectors

A form could ask for a name, a number and a date. It could not ask for a **file** — so a project
that needed a profile picture, a receipt or an attachment needed a developer, which is the thing
loom exists to avoid.

Two halves, and they only work together:

- **Upload fields** — `File field` and `Image field`, which sit in the input vocabulary beside the
  others and produce a value a database column can hold.
- **Bucket connectors** — a **Files** section on the rail where a project attaches somewhere for
  those files to live: local disk, Cloudflare R2, Amazon S3, Supabase Storage, Firebase Storage.

## The rule: the browser never holds a bucket credential

This is the whole design, and everything below follows from it. A bucket key in a browser is a
bucket anyone can write to — it is in the bundle, it is in the network tab, and it does not expire.

So an upload is three steps:

1. The browser asks the app's **own** server: "I want to put this file in this bucket."
2. The server — which holds the credentials — answers with a **ticket**: one URL, a method, the
   headers to send, and the key the file will have.
3. The browser sends the file to that URL. It never sees a credential, only a ticket that expires.

The same three steps for every provider, which is what makes the field provider-agnostic: the field
does not know whether it is talking to R2 or to a folder on a laptop.

### What the server decides, and the browser does not

| Decision | Why it cannot be the browser's |
| --- | --- |
| **The key** | A client-chosen path is a client that can overwrite anyone's file |
| **The content type** | It is signed *into* the ticket, so a ticket for a PNG cannot upload a script |
| **The size limit** | A limit enforced in a form is a limit anyone can skip |
| **Which types are allowed** | Same |
| **How long the ticket lasts** | Minutes, not days |

The key is built from the bucket's prefix, a random segment and a sanitised version of the original
name. The random segment is what stops two people uploading `photo.jpg` from overwriting each
other, and the sanitising is what stops a name being a path.

## The providers

Every endpoint and function below was read from the vendor's own material and is pinned in a test
that says where it came from. None of it is remembered.

| Provider | How the ticket is made | Source |
| --- | --- | --- |
| **Local disk** | The app signs a ticket back to its own `/api/upload` route | — |
| **Cloudflare R2** | `getSignedUrl(S3, new PutObjectCommand({ Bucket, Key, ContentType }))`, region `auto`, endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) |
| **Amazon S3** | The same `@aws-sdk/s3-request-presigner` call, with the real region and no endpoint override | [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) |
| **Supabase Storage** | `createSignedUploadUrl(path)` → `{ signedUrl, token, path }`; the browser `PUT`s to `signedUrl` | [storage-js source](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts) |
| **Firebase Storage** | `bucket.file(key).getSignedUrl({ version: 'v4', action: 'write', expires, contentType })` | [GCS V4 signed upload URL](https://docs.cloud.google.com/storage/docs/samples/storage-generate-upload-signed-url-v4) |

Cloudflare's own note is worth repeating, because it is the reason `ContentType` is in the ticket at
all: specifying it "restricts uploads to a specific file type, helping prevent abuse".

### Local disk is for development and for containers

It writes under a directory the app owns and serves the files back from its own server. That works
on a laptop and in a container with a volume. It does **not** work on a serverless host, where the
filesystem is temporary and per-invocation — the README says so in the project that uses it, rather
than letting someone discover it when their users' files disappear.

Its ticket is signed with `UPLOAD_SECRET` — an HMAC over the key and an expiry. Without that, the
upload route would be an open dropbox for anyone who found the URL.

## The fields

- **File field** — an `<input type="file">` that uploads as soon as a file is chosen, and whose
  value is the stored key. That value is text, so it flows into a column, a pipeline or another
  screen exactly like the value of a text field.
- **Image field** — the same, restricted to images, showing what was chosen.

Both report their own state, because an upload is the one input that can fail on its own: it is
idle, then busy, then done or refused. A field that silently does nothing while a 40 MB video
crawls up a hotel connection is a field people press twice.

## What is deliberately not here

- **No file browser.** Listing and deleting what is in a bucket is a management tool, and a builder
  that grows one grows a permissions model with it.
- **No image processing.** Resizing and cropping belong either in the bucket's own transform layer
  or in a step someone chooses, not silently inside an upload.
- **No multipart or resumable uploads.** They matter above a few hundred megabytes, and a builder
  claiming to handle a 50 GB upload it has never tried is worse than one that says it does not.
- **No public/private toggle.** Whether a bucket is public is a decision made *in the bucket*, by
  whoever owns it. A switch here would suggest loom can change it, and it cannot.
