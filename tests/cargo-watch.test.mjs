import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("includes the shipment dashboard and both supplied orders", async () => {
  const [dashboard, api] = await Promise.all([
    readFile(new URL("app/TrackerApp.tsx", root), "utf8"),
    readFile(new URL("app/api/shipments/route.ts", root), "utf8"),
  ]);

  assert.match(dashboard, /导入 Excel 或 CSV/);
  assert.match(dashboard, /搜索订单号、船名、提单号或箱号/);
  assert.match(api, /226GRD0390/);
  assert.match(api, /226GRD0664/);
});

test("configures cloud persistence and an order-number uniqueness rule", async () => {
  const [hosting, schema, migration] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0000_create_shipments.sql", root), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(schema, /shipments_order_no_unique/);
  assert.match(migration, /CREATE UNIQUE INDEX `shipments_order_no_unique`/);
});
