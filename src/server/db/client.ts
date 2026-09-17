import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Database = ReturnType<typeof drizzle>;
type DatabaseGlobals = typeof globalThis & {
  wishlistPool?: Pool;
  wishlistDatabase?: Database;
};

const databaseGlobals = globalThis as DatabaseGlobals;
let modulePool: Pool | undefined;
let moduleDatabase: Database | undefined;

function createDatabase(): Database {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required before the Wishlist database client can be used.",
    );
  }

  const pool =
    modulePool ??
    databaseGlobals.wishlistPool ??
    new Pool({
      connectionString: databaseUrl,
    });
  const database = moduleDatabase ?? drizzle({ client: pool });
  modulePool = pool;
  moduleDatabase = database;

  if (process.env.NODE_ENV !== "production") {
    databaseGlobals.wishlistPool = pool;
    databaseGlobals.wishlistDatabase = database;
  }
  return database;
}

function getDatabase(): Database {
  return moduleDatabase ?? databaseGlobals.wishlistDatabase ?? createDatabase();
}

/**
 * Keep database initialization lazy so `next build` can inspect Node route
 * modules without requiring a live deployment secret. The first actual query
 * still fails closed when DATABASE_URL is absent.
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = getDatabase();
    const value = Reflect.get(database, property, database) as unknown;
    return typeof value === "function" ? value.bind(database) : value;
  },
});
