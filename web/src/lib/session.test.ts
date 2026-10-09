import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '@/test/db';
import { systemAdmins, workspaceMembers, workspaces } from '@/db/schema';
import { AuthzError, type Ctx, type Database } from '@/lib/context';
import { provisionWorkspace, requireSystemAdmin } from './session';

let db: Database;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

describe('provisionWorkspace', () => {
  it('creates workspace + admin membership once, idempotently', async () => {
    const u = crypto.randomUUID();
    const a = await provisionWorkspace(db, u);
    const b = await provisionWorkspace(db, u);
    expect(b).toEqual(a);
    expect(a.role).toBe('admin');
  });
  it('is race-safe: concurrent first logins yield one workspace, no orphans', async () => {
    const before = (await db.select().from(workspaces)).length;
    const u = crypto.randomUUID();
    const rs = await Promise.all([1, 2, 3, 4].map(() => provisionWorkspace(db, u)));
    expect(new Set(rs.map((r) => r.workspaceId)).size).toBe(1);
    expect((await db.select().from(workspaces)).length).toBe(before + 1);
    expect((await db.select().from(workspaceMembers)).filter((m) => m.userId === u).length).toBe(1);
  });
  it('different users get different workspaces', async () => {
    const a = await provisionWorkspace(db, crypto.randomUUID());
    const b = await provisionWorkspace(db, crypto.randomUUID());
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });
});

describe('requireSystemAdmin', () => {
  it('allows listed user id, rejects others', async () => {
    const admin = crypto.randomUUID();
    await db.insert(systemAdmins).values({ userId: admin });
    const mk = (userId: string) => ({ userId, workspaceId: crypto.randomUUID(), role: 'admin', db, today: '2026-10-09' }) as Ctx;
    await expect(requireSystemAdmin(mk(admin))).resolves.toBeUndefined();
    await expect(requireSystemAdmin(mk(crypto.randomUUID()))).rejects.toBeInstanceOf(AuthzError);
  });
});
