import express from "express";
import cors from "cors";
import helmet from "helmet";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// ==== Config ====
const PORT = process.env.PORT || 3000;
const OPTIONS = ['PRIMER AÑO', 'SEGUNDO AÑO', 'TERCER AÑO', 'CUARTO AÑO', 'QUINTO AÑO'];

// ==== DB init ====
const dbPromise = open({
  filename: "data.db",
  driver: sqlite3.Database
});

async function initDB() {
  const db = await dbPromise;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS opciones (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS votos (
      opcion_id INTEGER PRIMARY KEY,
      cantidad INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(opcion_id) REFERENCES opciones(id)
    );

    CREATE TABLE IF NOT EXISTS votantes (
      ip TEXT PRIMARY KEY,
      voted_at TEXT NOT NULL
    );
  `);

  // Semilla inicial
  const { c } = await db.get(`SELECT COUNT(*) AS c FROM opciones`);
  if (c === 0) {
    const insertOpt = await db.prepare(`INSERT INTO opciones (id, nombre) VALUES (?, ?)`);
    const insertVote = await db.prepare(`INSERT INTO votos (opcion_id, cantidad) VALUES (?, 0)`);
    try {
      await db.exec("BEGIN");
      for (let i = 0; i < OPTIONS.length; i++) {
        const id = i + 1;
        await insertOpt.run(id, OPTIONS[i]);
        await insertVote.run(id);
      }
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      console.error("Error insertando semillas:", err);
    }
  }
}

// ==== App init ====
const app = express();
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json());

// Helper: obtener IP real
function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") {
    return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "unknown";
}

// GET /resultados
app.get("/resultados", async (req, res) => {
  const db = await dbPromise;
  const filas = await db.all(`
    SELECT o.id, o.nombre, v.cantidad
    FROM opciones o
    JOIN votos v ON v.opcion_id = o.id
    ORDER BY o.id ASC
  `);

  const total = filas.reduce((a, b) => a + b.cantidad, 0);

  res.json({
    total,
    resultados: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      cantidad: f.cantidad
    }))
  });
});

// POST /votar { optionId }
app.post("/votar", async (req, res) => {
  const { optionId } = req.body;
  if (!Number.isInteger(optionId) || optionId < 1 || optionId > OPTIONS.length) {
    return res.status(400).json({ ok: false, error: "optionId inválido" });
  }

  const db = await dbPromise;
  const ip = getClientIp(req);

  const ya = await db.get(`SELECT ip FROM votantes WHERE ip = ?`, ip);
  if (ya) {
    return res.status(409).json({ ok: false, error: "Este dispositivo/IP ya votó" });
  }

  try {
    await db.exec("BEGIN");
    await db.run(`UPDATE votos SET cantidad = cantidad + 1 WHERE opcion_id = ?`, optionId);
    await db.run(`INSERT INTO votantes (ip, voted_at) VALUES (?, datetime('now'))`, ip);
    await db.exec("COMMIT");

    res.json({ ok: true, message: "Voto registrado" });
  } catch (e) {
    await db.exec("ROLLBACK");
    console.error(e);
    res.status(500).json({ ok: false, error: "Error al registrar voto" });
  }
});

app.listen(PORT, async () => {
  await initDB();
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});