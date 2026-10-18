import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '@/test/db';
import {
  cardHolders,
  systemAdmins,
  workspaceMembers,
  workspaces,
} from '@/db/schema';
import type { Ctx, Database } from '@/lib/context';
import { getProfileView } from './profile';

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
});

afterAll(async () => {
  await close();
});

describe('profile domain', () => {
  it('correctly aggregates user profile view and workspace metrics', async () => {
    const userId = crypto.randomUUID();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Acme Family' })
      .returning();

    await db.insert(workspaceMembers).values({
      workspaceId: ws.id,
      userId,
      role: 'admin',
    });

    const ctx: Ctx = {
      userId,
      workspaceId: ws.id,
      role: 'admin',
      db,
      today: '2026-10-19',
    };

    // Initially 0 items
    const initialView = await getProfileView(ctx, {
      email: 'user@example.com',
      emailConfirmedAt: '2026-10-01T10:00:00Z',
      createdAt: '2026-10-01T09:00:00Z',
      lastSignInAt: '2026-10-19T01:00:00Z',
    });

    expect(initialView.email).toBe('user@example.com');
    expect(initialView.role).toBe('admin');
    expect(initialView.isSystemAdmin).toBe(false);
    expect(initialView.workspace.name).toBe('Acme Family');
    expect(initialView.stats.cardsCount).toBe(0);
    expect(initialView.stats.holdersCount).toBe(0);

    // Add card holder
    await db
      .insert(cardHolders)
      .values({
        workspaceId: ws.id,
        name: 'John Doe',
      });

    // Mark as system admin
    await db.insert(systemAdmins).values({
      userId,
    });

    const updatedView = await getProfileView(ctx, {
      email: 'user@example.com',
    });

    expect(updatedView.isSystemAdmin).toBe(true);
    expect(updatedView.stats.holdersCount).toBe(1);
  });
});
