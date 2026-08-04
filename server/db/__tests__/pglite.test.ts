import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { products, organizations } from '@shared/schema';
import { createPgliteProvider, createInMemoryPgliteProvider } from '../pglite.js';
import { execRows } from '../exec.js';

const TEST_ORG_ID = '00000000-0000-4000-8000-00000000aaaa';

describe('createPgliteProvider (in-memory smoke test)', () => {
  it('Given a fresh in-memory database, When migrated, Then inserts/selects/transactions work and close is idempotent', async () => {
    const provider = createInMemoryPgliteProvider();
    try {
      expect(provider.kind).toBe('pglite');
      await provider.migrate();

      // Insert
      await provider.db.insert(organizations).values({ id: TEST_ORG_ID, name: 'Test org', slug: 'test-org' });
      const [inserted] = await provider.db
        .insert(products)
        .values({ organizationId: TEST_ORG_ID, name: 'Test product', slug: 'test-product' })
        .returning();
      expect(inserted).toBeDefined();
      expect(inserted!.id).toMatch(/[0-9a-f-]{36}/); // gen_random_uuid() default fired

      // Select
      const found = await provider.db.select().from(products).where(eq(products.slug, 'test-product'));
      expect(found).toHaveLength(1);
      expect(found[0]!.name).toBe('Test product');

      // Transaction (rollback on error must leave no row behind)
      await expect(
        provider.db.transaction(async (tx) => {
          await tx.insert(products).values({ organizationId: TEST_ORG_ID, name: 'Doomed', slug: 'doomed' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const doomed = await provider.db.select().from(products).where(eq(products.slug, 'doomed'));
      expect(doomed).toHaveLength(0);

      // Transaction that commits
      await provider.db.transaction(async (tx) => {
        await tx.insert(products).values({ organizationId: TEST_ORG_ID, name: 'Kept', slug: 'kept' });
      });
      const kept = await provider.db.select().from(products).where(eq(products.slug, 'kept'));
      expect(kept).toHaveLength(1);
    } finally {
      await provider.close();
    }
    // Idempotent close
    await expect(provider.close()).resolves.toBeUndefined();
  });

  it('Given a migrated database, When executing raw SQL via execRows, Then rows come back in the pinned shape (ADR risk 4)', async () => {
    const provider = createInMemoryPgliteProvider();
    try {
      await provider.migrate();
      // The seam's contract: raw SQL call sites use execRows() and may rely
      // on the row array only — never on driver-specific result fields.
      const rows = await execRows<{ answer: number }>(provider.db, sql`select 1 as answer`);
      expect(rows).toEqual([{ answer: 1 }]);
    } finally {
      await provider.close();
    }
  });
});

describe('migration idempotency (persistent directory)', () => {
  it('Given an already-migrated data directory, When migrate runs again, Then it does not error and the schema is unchanged', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'discoveree-pglite-test-'));
    try {
      // First launch
      const first = createPgliteProvider(dataDir);
      await first.migrate();
      await first.db.insert(organizations).values({ id: TEST_ORG_ID, name: 'Persisted org', slug: 'persisted-org' });
      await first.close();

      // Second launch on the same directory — migrate must be a no-op
      const second = createPgliteProvider(dataDir);
      await second.migrate();
      await expect(second.migrate()).resolves.toBeUndefined(); // and safe to call twice in one process

      // Data written before the second migrate survives
      const orgs = await second.db.select().from(organizations).where(eq(organizations.slug, 'persisted-org'));
      expect(orgs).toHaveLength(1);

      // Each bundled migration is recorded exactly once, no matter how often
      // migrate ran. The expected count comes from the journal itself so the
      // idempotency assertion survives new migrations.
      const journal = JSON.parse(readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/migrations/meta/_journal.json'),
        'utf8',
      )) as { entries: unknown[] };
      const applied = await execRows<{ count: number }>(
        second.db,
        sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
      );
      expect(applied).toEqual([{ count: journal.entries.length }]);

      // Table count is stable (no duplicate/partial DDL).
      // 46 after the ADR 004 §8 final rewrite: the ADR 003 count (47:
      // +competitor_entities, +segment_entities, +personas, +persona_facets,
      // −customer_segment_personas) minus team_assignment_signals (dropped).
      const tables = await execRows<{ count: number }>(
        second.db,
        sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
      );
      expect(tables).toEqual([{ count: 46 }]);
      await second.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
