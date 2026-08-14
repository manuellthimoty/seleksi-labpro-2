import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

console.log("Start migration");

await migrate(db, { migrationsFolder: "./drizzle" });

console.log("Migrations complete.");

await pool.end();
