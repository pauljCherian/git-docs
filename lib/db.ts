import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

export function hasDbEnv() {
  return Boolean(databaseUrl);
}

// Return timestamptz as ISO strings instead of Date objects
pg.types.setTypeParser(1184, (val: string) => val);

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }

  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  }

  return pool;
}
