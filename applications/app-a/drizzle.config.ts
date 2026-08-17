import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "node:path";

// Local CLI usage (drizzle-kit generate/migrate) runs from this workspace
// dir, but the real DATABASE_URL lives in the repo-root .env.
config({ path: path.resolve(process.cwd(), "../../.env") });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? `postgres://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:${process.env.POSTGRES_PORT}/app_a`,
  },
});
