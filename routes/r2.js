import express from "express";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_REGION = "auto",
  R2_ENDPOINT,
} = process.env;

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

// POST /r2/presign-put -> returns { key, putUrl }
router.post("/presign-put", async (req, res) => {
  try {
    const { folder = "uploads", contentType = "application/octet-stream" } = req.body || {};
    const key = `${folder}/${uuidv4()}`;

    const cmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const putUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 }); // 5 min
    res.json({ key, putUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_presign_put" });
  }
});

// GET /r2/presign-get?key=...
router.get("/presign-get", async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "key_required" });

    const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
    const getUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 }); // 10 min
    res.json({ key, getUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed_to_presign_get" });
  }
});

export default router;
