import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  writeBatch,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pageOf, pageQuery } from '../src/data/live';
import { PAGE_SIZE } from '../src/lib/paginate';

// The log pages run through the same security rules the panel does, as the
// person who may read them — so a query shape the rules refuse fails here.
const rulesPath =
  process.env.RULES_PATH ?? fileURLToPath(new URL('../../SCM/firestore.rules', import.meta.url));

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-scm',
    firestore: { rules: readFileSync(rulesPath, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    const batch = writeBatch(db);
    batch.set(doc(db, 'operators', 'admin1'), { name: 'Pivithuru', role: 'admin', machineId: '' });
    batch.set(doc(db, 'operators', 'sup1'), { name: 'Nimal', role: 'supervisor', machineId: '' });
    await batch.commit();
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

/**
 * [count] entries in [name], timestamped [distinct] ways between them — so many
 * share one instant, as entries written by a single batch do. A page boundary
 * that falls among them has to be told apart by document id, not by time.
 */
async function seed(name: string, count: number, distinct = 10) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore;
    const start = Date.UTC(2026, 9, 1);
    for (let from = 0; from < count; from += 400) {
      const batch = writeBatch(db);
      for (let index = from; index < Math.min(from + 400, count); index++) {
        batch.set(doc(db, name, `e${String(index).padStart(4, '0')}`), {
          createdAt: Timestamp.fromMillis(start + (index % distinct) * 1000),
          createdBy: 'admin1',
        });
      }
      await batch.commit();
    }
  });
}

/** Reads the log a page at a time, the way the hook does, until a page says nothing follows. */
async function walk(db: Firestore, name: string, size = PAGE_SIZE) {
  const base: Query = query(collection(db, name), orderBy('createdAt', 'desc'));
  const pages: { ids: string[]; more: boolean }[] = [];
  let after: QueryDocumentSnapshot | null = null;
  for (;;) {
    const { shown, more }: { shown: QueryDocumentSnapshot[]; more: boolean } = pageOf(
      (await getDocs(pageQuery(base, after, size))).docs,
      size,
    );
    pages.push({ ids: shown.map((entry) => entry.id), more });
    if (!more) return pages;
    after = shown[shown.length - 1];
  }
}

describe('paging through a log', () => {
  it('reads 100 to a page and tells the last page from the ones before it', async () => {
    await seed('auditLog', 250);
    const pages = await walk(as('admin1'), 'auditLog');
    expect(pages.map((page) => page.ids.length)).toEqual([100, 100, 50]);
    expect(pages.map((page) => page.more)).toEqual([true, true, false]);
  });

  it('loses no entry and repeats none, even where many share one instant', async () => {
    await seed('auditLog', 250, 3);
    const db = as('admin1');
    const everything = await getDocs(query(collection(db, 'auditLog'), orderBy('createdAt', 'desc')));
    const paged = (await walk(db, 'auditLog')).flatMap((page) => page.ids);
    expect(paged).toHaveLength(250);
    expect(new Set(paged).size).toBe(250);
    // The same entries in the same order as one read of the whole log.
    expect(paged).toEqual(everything.docs.map((entry) => entry.id));
  });

  it('does not offer a next page after exactly 100 entries', async () => {
    await seed('auditLog', 100);
    const pages = await walk(as('admin1'), 'auditLog');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ more: false });
    expect(pages[0].ids).toHaveLength(100);
  });

  it('offers one after 101', async () => {
    await seed('auditLog', 101);
    const pages = await walk(as('admin1'), 'auditLog');
    expect(pages.map((page) => page.ids.length)).toEqual([100, 1]);
    expect(pages[0].more).toBe(true);
  });

  it('is a single empty page for a log with nothing in it', async () => {
    expect(await walk(as('admin1'), 'auditLog')).toEqual([{ ids: [], more: false }]);
  });

  it('asks for one row more than a page, and no more', async () => {
    await seed('auditLog', 250);
    const base = query(collection(as('admin1'), 'auditLog'), orderBy('createdAt', 'desc'));
    expect((await getDocs(pageQuery(base, null))).size).toBe(PAGE_SIZE + 1);
  });

  it('works for the store movements a supervisor may read, and is refused for the audit log', async () => {
    await seed('storeMovements', 150);
    await seed('auditLog', 5);
    const supervisor = as('sup1');
    const pages = await walk(supervisor, 'storeMovements');
    expect(pages.map((page) => page.ids.length)).toEqual([100, 50]);
    await expect(walk(supervisor, 'auditLog')).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
