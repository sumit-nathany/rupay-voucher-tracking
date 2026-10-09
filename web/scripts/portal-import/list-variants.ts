import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema';
import { asc } from 'drizzle-orm';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  const variants = await db.select({ name: schema.cardVariants.name }).from(schema.cardVariants).orderBy(asc(schema.cardVariants.name));
  console.log('Available variants:');
  variants.forEach(v => console.log('  -', v.name));

  await client.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
