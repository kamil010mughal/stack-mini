import { createRequire } from "module";
import { imagesRouter } from "./routes/images.js";
const require = createRequire(import.meta.url);
import r2Routes from "./routes/r2.js";
// server.js
import express from "express";
const { Client } = require("pg");
const app = express();
app.use(express.json());
app.use("/r2", r2Routes);
app.use("/images", imagesRouter);

app.use(express.static("public"));
const port = 8080;

// DB config (env se ayega; local-compose defaults bhi rakhe)
const cfg = () => ({
  host: process.env.DB_HOST || "db",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "appdb",
  port: Number(process.env.DB_PORT || 5432),
});

// Home
app.get("/", (_req, res) => {
  res.send(`
    <!doctype html>
    <html><head><meta charset="utf-8"><title>Stack Mini ✅</title></head>
    <body style="font-family:system-ui;padding:24px">
      <h1>Stack Mini ✅</h1>
      <p><a href="/health">/health</a> — API health</p>
      <p><a href="/db-check">/db-check</a> — test Postgres</p>
      <p><a href="/cpu">/cpu</a> — tiny CPU burn (HPA demo)</p>
    </body></html>
  `);
});

// Health (readiness/liveness)
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// HPA demo: ~300ms CPU burn
app.get("/cpu", (_req, res) => {
  const end = Date.now() + 300;
  while (Date.now() < end) Math.sqrt(Math.random());
  res.json({ ok: true, burn: "300ms" });
});

// DB check
app.get("/db-check", async (_req, res) => {
  const c = new Client(cfg());
  try {
    await c.connect();
    const r = await c.query("SELECT NOW() as now");
    res.json({ ok: true, now: r.rows[0].now, host: cfg().host });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    try { await c.end(); } catch {}
  }
});

// Start server (keep this at the very end)
app.listen(port, () => console.log(`Server on http://localhost:${port}`));
