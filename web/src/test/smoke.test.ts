import { it, expect } from 'vitest';
import { createTestDb } from './db';
import { workspaces } from '@/db/schema';

it('test db applies migrations', async () => {
  const { db, close } = await createTestDb();
  await db.insert(workspaces).values({ name: 'w' });
  expect((await db.select().from(workspaces)).length).toBe(1);
  await close();
});
