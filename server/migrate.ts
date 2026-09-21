import { Database, migrate } from "./db";
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error(
    "Set MIGRATION_DATABASE_URL for the separate migration owner",
  );
process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const db = new Database();
await migrate(db);
await db.close();
console.log("Schema migration complete");
