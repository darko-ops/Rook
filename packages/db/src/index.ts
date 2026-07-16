import postgres from 'postgres';

export { migrate } from './migrate.js';

export type Sql = postgres.Sql;

/** Resolved lazily so tests can point at an isolated database before first use. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://rook:rook@localhost:5455/rook';
}

let shared: Sql | null = null;

/** Shared connection pool. Numerics come back as JS numbers (play-money scale). */
export function db(): Sql {
  if (!shared) {
    shared = postgres(databaseUrl(), {
      max: 10,
      onnotice: () => {},
      types: {
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (x: number) => x.toString(),
          parse: (x: string) => Number(x),
        },
      },
    });
  }
  return shared;
}

export async function closeDb(): Promise<void> {
  if (shared) {
    await shared.end();
    shared = null;
  }
}
