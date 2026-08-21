import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});


// pg.Pool nge-emit 'error' kalau koneksi IDLE putus (misal Postgres restart).
// EventEmitter tanpa listener 'error' bikin Node ngelempar dan proses mati
// jadi database yang mati sebentar bisa ngebunuh service yang sebenarnya sehat.
pool.on("error", (err) => {
  console.error(`[db] koneksi idle bermasalah: ${err.message}`);
});

export const db = drizzle(pool,{ schema });
