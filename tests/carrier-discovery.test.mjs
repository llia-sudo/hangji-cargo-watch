import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses a three-layer carrier discovery path with bounded deep discovery", async () => {
  const [carriers, tracking, online] = await Promise.all([
    readFile(new URL("app/lib/carriers.ts", root), "utf8"),
    readFile(new URL("app/lib/tracking.ts", root), "utf8"),
    readFile(new URL("app/lib/online-carrier-identification.ts", root), "utf8"),
  ]);

  assert.match(carriers, /id: "lyg-ferry"/);
  assert.match(carriers, /documentPrefixes: \["LYFR"\]/);
  assert.match(carriers, /cargo\.lygferry\.com\/biz\/scheduleView\.do/);
  assert.match(online, /DUCKDUCKGO_SEARCH_URL/);
  assert.match(online, /DISCOVERY_BUDGET_MS = 8_000/);
  assert.match(online, /bill of lading prefix shipping line carrier/);
  assert.match(online, /discoverUnknownCarrierCandidate/);
  assert.match(online, /联网发现候选/);
  assert.match(tracking, /Layer 2: known official sources/);
  assert.match(tracking, /Layer 3: only after local rules\/history/);
  assert.ok(
    tracking.indexOf("discoverUnknownCarrierByOfficialSchedule") <
      tracking.lastIndexOf("findCarrierOnline(shipment, session)")
  );
  assert.match(tracking, /setTimeout\(\(\) => resolve\(undefined\), 8_000\)/);
});
