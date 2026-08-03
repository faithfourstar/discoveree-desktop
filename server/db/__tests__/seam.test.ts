import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { organizations, organizationUsers, users, products } from '@shared/schema';
import { initDatabase, getDb, db, closeDatabase } from '../index.js';
import {
  seedLocalData,
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  LOCAL_MEMBERSHIP_ID,
  LOCAL_ORGANIZATION_NAME,
} from '../seedLocal.js';

// Each test starts from an uninitialised seam.
beforeEach(async () => {
  await closeDatabase();
});
afterEach(async () => {
  await closeDatabase();
});

describe('seam initialisation', () => {
  it('Given no initDatabase call, When getDb is used, Then it throws a clear error', () => {
    expect(() => getDb()).toThrow(/not initialised/i);
  });

  it('Given no initDatabase call, When the db proxy is touched, Then it throws a clear error', () => {
    expect(() => db.select).toThrow(/not initialised/i);
  });

  it('Given an initialised seam, When initDatabase is called again, Then it refuses', async () => {
    await initDatabase({ target: 'pglite', dataDir: 'memory://' });
    await expect(initDatabase({ target: 'pglite', dataDir: 'memory://' })).rejects.toThrow(/already initialised/i);
  });

  it('Given an initialised seam, When using the db proxy, Then calls delegate to the real database', async () => {
    await initDatabase({ target: 'pglite', dataDir: 'memory://' });
    // The proxy and getDb() hit the same instance
    await db.insert(products).values({ organizationId: LOCAL_ORGANIZATION_ID, name: 'Proxy product', slug: 'proxy-product' });
    const viaGetDb = await getDb().select().from(products).where(eq(products.slug, 'proxy-product'));
    expect(viaGetDb).toHaveLength(1);
  });

  it('Given an initialised seam, When closeDatabase runs twice, Then both calls succeed and the seam resets', async () => {
    await initDatabase({ target: 'pglite', dataDir: 'memory://' });
    await closeDatabase();
    await expect(closeDatabase()).resolves.toBeUndefined();
    expect(() => getDb()).toThrow(/not initialised/i);
  });
});

describe('seed bootstrap', () => {
  it('Given a first run, When initDatabase completes, Then exactly one local org, user, and membership exist with fixed ids', async () => {
    await initDatabase({ target: 'pglite', dataDir: 'memory://' });

    const orgs = await getDb().select().from(organizations);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.id).toBe(LOCAL_ORGANIZATION_ID);
    expect(orgs[0]!.name).toBe(LOCAL_ORGANIZATION_NAME);
    expect(orgs[0]!.useOwnLlmKeys).toBe(true);

    const allUsers = await getDb().select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]!.id).toBe(LOCAL_USER_ID);

    const memberships = await getDb().select().from(organizationUsers);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.id).toBe(LOCAL_MEMBERSHIP_ID);
    expect(memberships[0]!.organizationId).toBe(LOCAL_ORGANIZATION_ID);
    expect(memberships[0]!.userId).toBe(LOCAL_USER_ID);
    expect(memberships[0]!.seatType).toBe('pro');
    expect(memberships[0]!.isAdmin).toBe(true);
  });

  it('Given an already-seeded database, When the seed runs again, Then it is a no-op (idempotent)', async () => {
    await initDatabase({ target: 'pglite', dataDir: 'memory://' });
    await seedLocalData(getDb());
    await seedLocalData(getDb());

    expect(await getDb().select().from(organizations)).toHaveLength(1);
    expect(await getDb().select().from(users)).toHaveLength(1);
    expect(await getDb().select().from(organizationUsers)).toHaveLength(1);
  });

  it('Given a user renamed by onboarding, When the seed runs again, Then it does not overwrite the row (merge, don\'t replace)', async () => {
    await initDatabase({ target: 'pglite', dataDir: 'memory://' });
    await getDb().update(users).set({ name: 'Faith Forster', email: 'faith@discoveree.com' }).where(eq(users.id, LOCAL_USER_ID));

    await seedLocalData(getDb());

    const allUsers = await getDb().select().from(users);
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]!.name).toBe('Faith Forster');
    expect(allUsers[0]!.email).toBe('faith@discoveree.com');
  });
});
