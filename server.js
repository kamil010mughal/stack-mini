// server.js
const express = require("express");
const { Client } = require("pg");
const app = express();
app.use(express.static("public"));
const port = 8080;

// env (compose se ayegi)
const cfg = () => ({
  host: process.env.DB_HOST || "db",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "appdb",
  port: Number(process.env.DB_PORT || 5432),
});

app.get("/", (_req, res) => {
  res.send(`
  <h1>Stack Mini ✅</h1>
  <p><a href="/db-check">/db-check</a> — test Postgres</p>
  `);
});

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

app.listen(port, () => console.log(`Server on http://localhost:${port}`));
