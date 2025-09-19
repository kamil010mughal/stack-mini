import express from "express";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const imagesRouter = express.Router();

// Save key
imagesRouter.post("/save-key", async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ ok: false, error: "key required" });

    const q = `INSERT INTO images (r2_key) VALUES ($1)
               ON CONFLICT (r2_key) DO UPDATE SET r2_key = EXCLUDED.r2_key
               RETURNING id, r2_key;`;
    const { rows } = await pool.query(q, [key]);
    res.json({ ok: true, image: rows[0] });
  } catch (err) {
    console.error("save-key error:", err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Get key by ID
imagesRouter.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad id" });

    const { rows } = await pool.query(
      "SELECT id, r2_key FROM images WHERE id=$1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, image: rows[0] });
  } catch (err) {
    console.error("get image error:", err);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});
