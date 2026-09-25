import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { CURRENCY_MINOR_UNIT_EXPONENT } from "@splitty/shared";
import { createDb, type Database } from "./client.js";
import { categories, currencies } from "./schema.js";
import { loadEnv } from "../env.js";

// docs/PLAN-PUBLIC.md §6/Phase 0: seed the currencies table and a starter
// category tree. Idempotent (check-then-insert) so it's safe to re-run
// against an existing database rather than only working once on a fresh one.

const CATEGORY_TREE: Array<{ name: string; icon: string; children?: Array<{ name: string; icon: string }> }> = [
  {
    name: "Food & Drink",
    icon: "utensils",
    children: [
      { name: "Groceries", icon: "shopping-cart" },
      { name: "Restaurants & Bars", icon: "wine-glass" },
      { name: "Coffee & Snacks", icon: "coffee" },
    ],
  },
  {
    name: "Home",
    icon: "home",
    children: [
      { name: "Rent & Mortgage", icon: "key" },
      { name: "Utilities", icon: "bolt" },
      { name: "Household Supplies", icon: "spray-can" },
    ],
  },
  {
    name: "Transportation",
    icon: "car",
    children: [
      { name: "Gas & Fuel", icon: "gas-pump" },
      { name: "Public Transit", icon: "bus" },
      { name: "Taxi & Rideshare", icon: "taxi" },
      { name: "Parking", icon: "parking" },
    ],
  },
  {
    name: "Entertainment",
    icon: "film",
    children: [
      { name: "Movies & Events", icon: "ticket" },
      { name: "Games & Hobbies", icon: "gamepad" },
    ],
  },
  {
    name: "Travel",
    icon: "plane",
    children: [
      { name: "Flights", icon: "plane-departure" },
      { name: "Lodging", icon: "bed" },
    ],
  },
  { name: "Shopping", icon: "shopping-bag" },
  { name: "Health & Wellness", icon: "heart-pulse" },
  { name: "Other", icon: "ellipsis" },
];

async function upsertCategory(db: Database, name: string, icon: string, parentId: string | null): Promise<string> {
  const parentCondition = parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId);
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, name), parentCondition));
  if (existing) return existing.id;

  const [inserted] = await db.insert(categories).values({ name, icon, parentId }).returning({ id: categories.id });
  if (!inserted) throw new Error(`Failed to insert category "${name}"`);
  return inserted.id;
}

async function seedCurrencies(db: Database): Promise<void> {
  for (const [code, minorUnitExponent] of Object.entries(CURRENCY_MINOR_UNIT_EXPONENT)) {
    await db.insert(currencies).values({ code, minorUnitExponent }).onConflictDoUpdate({
      target: currencies.code,
      set: { minorUnitExponent },
    });
  }
  console.log(`Seeded ${Object.keys(CURRENCY_MINOR_UNIT_EXPONENT).length} currencies.`);
}

async function seedCategories(db: Database): Promise<void> {
  let count = 0;
  for (const top of CATEGORY_TREE) {
    const parentId = await upsertCategory(db, top.name, top.icon, null);
    count++;
    for (const child of top.children ?? []) {
      await upsertCategory(db, child.name, child.icon, parentId);
      count++;
    }
  }
  console.log(`Seeded ${count} categories.`);
}

async function main() {
  const env = loadEnv();
  const { db, close } = createDb(env.DATABASE_URL);
  await seedCurrencies(db);
  await seedCategories(db);
  await close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
