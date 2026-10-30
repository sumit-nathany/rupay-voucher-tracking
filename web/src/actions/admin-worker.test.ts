import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@/test/db';
import { systemAdmins, workspaces } from '@/db/schema';
import { AuthzError, type Ctx } from '@/lib/context';
import { requireSystemAdmin, isSystemAdmin } from '@/lib/session';

let db: Ctx['db'];
let close: () => Promise<void>;
let superAdminCtx: Ctx;
let normalUserCtx: Ctx;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [w] = await db.insert(workspaces).values({ name: 'Test WS' }).returning();
  superAdminCtx = {
    userId: randomUUID(),
    workspaceId: w.id,
    role: 'member',
    db,
    today: '2026-10-30',
  };
  normalUserCtx = {
    userId: randomUUID(),
    workspaceId: w.id,
    role: 'admin', // Workspace admin, but NOT system admin
    db,
    today: '2026-10-30',
  };

  await db.insert(systemAdmins).values({ userId: superAdminCtx.userId });
});

afterAll(async () => {
  await close();
});

describe('Super Admin Cloud Worker Authorization', () => {
  it('identifies super admin vs normal user', async () => {
    expect(await isSystemAdmin(db, superAdminCtx.userId)).toBe(true);
    expect(await isSystemAdmin(db, normalUserCtx.userId)).toBe(false);
  });

  it('allows super admin via requireSystemAdmin', async () => {
    await expect(requireSystemAdmin(superAdminCtx)).resolves.not.toThrow();
  });

  it('rejects normal user (even if workspace admin) with AuthzError', async () => {
    await expect(requireSystemAdmin(normalUserCtx)).rejects.toBeInstanceOf(AuthzError);
  });
});
