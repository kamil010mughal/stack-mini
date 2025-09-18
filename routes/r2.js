import express from "express";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_REGION = "auto",
  R2_ENDPOINT, // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
} = process.env;

// Build virtual-hosted endpoint => https://<BUCKET>.<ACCOUNT>.r2.cloudflarestorage.com
const makeEndpoint = () => {
  const ep = (R2_ENDPOINT || "").replace(/^https?:\/\//, "");
  const host = ep.startsWith(`${R2_BUCKET}.`) ? ep : `${R2_BUCKET}.${ep}`;
  return `https://${host}`;
};

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: makeEndpoint(),
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: false, // virtual-hosted style
});

// Health/ping (optional)
router.get("/ping", async (_req, res) => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
    res.json({ ok: true, bucket: R2_BUCKET, endpoint: makeEndpoint() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "r2_unreachable" });
  }
});

// ---- Server-side UPLOAD (no presign, avoids client TLS issues) ----
// Send binary body to this route. Example:
// curl -X POST --data-binary @test.jpg "http://.../r2/upload?folder=images&filename=test.jpg" -H "Content-Type: image/jpeg"
router.use("/upload", express.raw({ type: "*/*", limit: "50mb" }));
router.post("/upload", async (req, res) => {
  try {
    const folder = req.query.folder || "uploads";
    const filename = req.query.filename || `${uuidv4()}`;
    const key = `${folder}/${filename}`;
    const contentType = req.headers["content-type"] || "application/octet-stream";
    const body = req.body;

    if (!body || !body.length) {
      return res.status(400).json({ error: "empty_body" });
    }

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));

    res.json({ ok: true, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "upload_failed" });
  }
});

// ---- Server-side STREAM (no presign GET needed) ----
// Example: curl -I "http://.../r2/stream?key=images/test.jpg"
router.get("/stream", async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "key_required" });

    const out = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    // Copy useful headers
    if (out.ContentType) res.setHeader("Content-Type", out.ContentType);
    if (out.ContentLength) res.setHeader("Content-Length", out.ContentLength.toString());
    if (out.ETag) res.setHeader("ETag", out.ETag);
    // Stream body
    out.Body.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: "not_found_or_fetch_failed" });
  }
});

// ---- Presign (client direct) — kept for later when TLS works ----
router.post("/presign-put", async (req, res) => {
  try {
    const { folder = "uploads", contentType = "application/octet-stream" } = req.body || {};
    const key = `${folder}/${uuidv4()}`;
    const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType });
    const putUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    res.json({ key, putUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_presign_put" });
  }
});

router.get("/presign-get", async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "key_required" });
    const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
    const getUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 });
    res.json({ key, getUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_presign_get" });
  }
});

export default router;
