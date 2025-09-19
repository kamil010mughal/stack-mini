import express from "express";
import https from "https";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@aws-sdk/node-http-handler";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_REGION = "auto",
  R2_ENDPOINT, // e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
} = process.env;

if (!R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
  console.error("R2 env missing. Need R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT");
}

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  forcePathStyle: true, // R2 requires path-style
  // Force TLS v1.2 (some networks/proxies break TLS1.3 handshakes)
  httpHandler: new NodeHttpHandler({
    requestTimeout: 30000,
    connectionTimeout: 30000,
    httpsAgent: new https.Agent({
      minVersion: "TLSv1.2",
      keepAlive: true,
    }),
  }),
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || "",
    secretAccessKey: R2_SECRET_ACCESS_KEY || "",
  },
});

const r2Routes = express.Router();

// Use raw parser here so binary body stays intact
r2Routes.use(express.raw({ type: "*/*", limit: "50mb" }));

// POST /r2/upload?folder=images&filename=test.jpg
r2Routes.post("/upload", async (req, res) => {
  try {
    const folder = (req.query.folder || "").toString().trim();
    const filename = (req.query.filename || "").toString().trim();
    if (!folder || !filename) {
      return res.status(400).json({ ok: false, error: "folder_and_filename_required" });
    }
    const key = `${folder.replace(/\/+$/,"")}/${filename.replace(/^\/+/, "")}`;

    const contentType = req.header("content-type") || "application/octet-stream";

    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: req.body,            // binary buffer
      ContentType: contentType,
    }));

    return res.json({ ok: true, key });
  } catch (err) {
    console.error("R2 upload error:", err);
    return res.status(500).json({ ok: false, error: "upload_failed" });
  }
});

// GET /r2/stream?key=images/test.jpg
r2Routes.get("/stream", async (req, res) => {
  try {
    const key = (req.query.key || "").toString().trim();
    if (!key) return res.status(400).json({ ok: false, error: "key_required" });

    const data = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));

    if (data.ContentType) res.setHeader("Content-Type", data.ContentType);
    if (data.ContentLength) res.setHeader("Content-Length", String(data.ContentLength));
    if (data.ETag) res.setHeader("ETag", data.ETag);

    data.Body.pipe(res);
  } catch (err) {
    console.error("R2 stream error:", err);
    return res.status(404).json({ ok: false, error: "not_found" });
  }
});

export default r2Routes;
