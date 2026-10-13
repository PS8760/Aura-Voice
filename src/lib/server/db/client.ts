import { MongoClient, type Db } from "mongodb";

/**
 * MongoDB connection helper.
 *
 * The workspace runs with zero required infrastructure: if `MONGODB_URI` is not
 * configured we transparently fall back to an in-memory store (see
 * `repositories.ts`). When a URI is present we keep a single client alive across
 * hot reloads by caching it on `globalThis`.
 */

interface CachedClient {
  client: MongoClient;
  db: Db;
}

const globalForMongo = globalThis as typeof globalThis & {
  __auraMongo?: CachedClient;
};

export function mongoUri(): string | null {
  const uri = process.env.MONGODB_URI?.trim();
  return uri && uri.length > 0 ? uri : null;
}

export function isMongoConfigured(): boolean {
  return mongoUri() !== null;
}

export function mongoDbName(): string {
  const name = process.env.MONGODB_DB?.trim();
  return name && name.length > 0 ? name : "aura_voice_cx";
}

export async function getMongoDb(): Promise<Db | null> {
  const uri = mongoUri();
  if (!uri) return null;
  if (globalForMongo.__auraMongo) return globalForMongo.__auraMongo.db;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4_000 });
  await client.connect();
  const db = client.db(mongoDbName());
  globalForMongo.__auraMongo = { client, db };
  return db;
}

export async function closeMongo(): Promise<void> {
  const cached = globalForMongo.__auraMongo;
  if (!cached) return;
  globalForMongo.__auraMongo = undefined;
  await cached.client.close();
}
