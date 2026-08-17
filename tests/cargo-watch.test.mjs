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
  const [hosting, schema, migration, historyMigration, archiveMigration, baselineMigration] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0000_create_shipments.sql", root), "utf8"),
    readFile(new URL("drizzle/0002_shipment_schedule_history.sql", root), "utf8"),
    readFile(new URL("drizzle/0003_archive_shipments.sql", root), "utf8"),
    readFile(new URL("drizzle/0004_baseline_schedule.sql", root), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(schema, /shipments_order_no_unique/);
  assert.match(migration, /CREATE UNIQUE INDEX `shipments_order_no_unique`/);
  assert.match(schema, /shipmentScheduleHistory/);
  assert.match(historyMigration, /CREATE TABLE `shipment_schedule_history`/);
  assert.match(historyMigration, /idx_shipment_schedule_history_shipment_checked/);
  assert.match(schema, /archivedAt/);
  assert.match(archiveMigration, /archived_at/);
  assert.match(schema, /baselineEtd/);
  assert.match(schema, /baselineEta/);
  assert.match(baselineMigration, /baseline_etd/);
  assert.match(baselineMigration, /baseline_eta/);
});

test("protects the page and shipment API with server-side password sessions", async () => {
  const [page, shipmentApi, auth, login, migration] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/shipments/route.ts", root), "utf8"),
    readFile(new URL("app/lib/password-auth.ts", root), "utf8"),
    readFile(new URL("app/api/auth/login/route.ts", root), "utf8"),
    readFile(new URL("drizzle/0001_password_access.sql", root), "utf8"),
  ]);

  assert.match(page, /hasValidPageSession/);
  assert.match(shipmentApi, /hasValidRequestSession/);
  assert.match(auth, /ACCESS_PASSWORD_HASH/);
  assert.match(auth, /HttpOnly/);
  assert.match(login, /MAX_FAILURES = 5/);
  assert.match(migration, /CREATE TABLE `auth_attempts`/);
});

test("one-click sync queries supported carrier sources and writes results back", async () => {
  const [dashboard, shipmentApi, syncApi, tracking, carriers, onlineIdentification, shipmentHistory] = await Promise.all([
    readFile(new URL("app/TrackerApp.tsx", root), "utf8"),
    readFile(new URL("app/api/shipments/route.ts", root), "utf8"),
    readFile(new URL("app/api/shipments/sync/route.ts", root), "utf8"),
    readFile(new URL("app/lib/tracking.ts", root), "utf8"),
    readFile(new URL("app/lib/carriers.ts", root), "utf8"),
    readFile(new URL("app/lib/online-carrier-identification.ts", root), "utf8"),
    readFile(new URL("db/shipment-history.ts", root), "utf8"),
  ]);

  assert.match(dashboard, /一键更新全部/);
  assert.match(dashboard, /fetch\("\/api\/shipments\/sync"/);
  assert.match(syncApi, /syncInSmallBatches/);
  assert.match(syncApi, /last_checked_at = \?/);
  assert.match(tracking, /Evergreen ShipmentLink 官网/);
  assert.match(tracking, /PANCON 官网船期/);
  assert.match(tracking, /selectWeb211\.pcl/);
  assert.match(tracking, /rangeCode === "01" \? 35_000 : 45_000/);
  assert.match(tracking, /firstDayOfPanconMonth/);
  assert.match(tracking, /reportedAta !== eta/);
  assert.match(syncApi, /createTrackingSession/);
  assert.match(tracking, /detectCarrier/);
  assert.match(carriers, /rank: 1/);
  assert.match(carriers, /rank: 10/);
  assert.match(carriers, /KMTC/);
  assert.match(carriers, /Emirates Shipping Line/);
  assert.match(dashboard, /船公司查询网络/);
  assert.doesNotMatch(dashboard, /全球前十大班轮公司/);
  assert.match(dashboard, /船公司<\/span><select/);
  assert.match(dashboard, /未知船公司识别/);
  assert.match(dashboard, /source-network-grid/);
  assert.match(carriers, /vesselName: "CONCERTO"/);
  assert.match(carriers, /vesselName: "REN JIAN 27"/);
  assert.match(carriers, /carrierId: "sinotrans"/);
  assert.match(carriers, /e-sinokor\.com\/Schedule\/vsl-schedule/);
  assert.match(carriers, /Sinotrans Container Lines/);
  assert.match(carriers, /ebusiness\.sinolines\.com\.cn\/Ebusiness\/EQUERY\/QuerySchedule\.aspx/);
  assert.match(carriers, /SHANGHAI INCHON INTERNATIONAL FERRY/);
  assert.match(onlineIdentification, /https:\/\/search\.brave\.com\/search/);
  assert.match(onlineIdentification, /best\.official && best\.score >= 12/);
  assert.match(tracking, /identifyCarrierOnline/);
  assert.match(syncApi, /identified: identified\.length/);
  assert.match(dashboard, /single-sync-button/);
  assert.match(dashboard, /syncFailureDetails\.map/);
  assert.doesNotMatch(dashboard, /\.slice\(0, 3\)/);
  assert.match(dashboard, /JSON\.stringify\(\{ orderNo: shipment\.orderNo \}\)/);
  assert.match(syncApi, /requestedOrderNo/);
  assert.match(syncApi, /shipment\.orderNo === requestedOrderNo/);
  assert.match(tracking, /COSCO eLines 全球官网船期/);
  assert.match(tracking, /ebschedule\/public\/purpoShipment\/vesselCode/);
  assert.match(tracking, /findVesselByPrefix/);
  assert.match(tracking, /coscoSessionCookie/);
  assert.match(tracking, /queryCoscoGlobal/);
  assert.match(tracking, /尚未发布相同船名航次/);
  assert.match(tracking, /ONE 全球官网船期/);
  assert.match(tracking, /HMM 全球官网船期/);
  assert.match(tracking, /Yang Ming 全球官网船期/);
  assert.match(tracking, /Maersk 全球官网船期/);
  assert.match(tracking, /中外运集运官网船期/);
  assert.match(tracking, /SINOTRANS_VESSEL_LIST_URL/);
  assert.match(tracking, /body\.set\("autocomplete_vsl", vessel\.label\)/);
  assert.match(tracking, /BTbyvslvoy/);
  assert.match(tracking, /parseSinotransTimes/);
  assert.match(tracking, /中外运官方船名库精确匹配后的智能回退/);
  assert.match(tracking, /queryOne/);
  assert.match(tracking, /queryHmm/);
  assert.match(tracking, /data\.RTN_DATA\?\.boardList \?\? data\.boardList/);
  assert.match(tracking, /hmmVoyageFamily/);
  assert.match(tracking, /allowOoclInlandContinuation/);
  assert.match(tracking, /queryYangMing/);
  assert.match(tracking, /queryMaersk/);
  assert.match(tracking, /active-vessels\?carrierCodes=MAEU/);
  assert.match(tracking, /synergy\/schedules\/vessel-schedules/);
  assert.match(tracking, /departureVoyageNumber/);
  assert.match(tracking, /arrivalVoyageNumber/);
  assert.match(tracking, /API 授权凭据/);
  assert.match(tracking, /启运港或目的港不在该航次港序中/);
  assert.match(carriers, /maersk\.com\/schedules\/vesselSchedules/);
  assert.match(carriers, /hapag-lloyd\.com\/solutions\/schedule/);
  assert.match(carriers, /api-credentials/);
  assert.match(dashboard, /<strong>Maersk<\/strong>/);
  assert.match(dashboard, /需授权/);
  assert.match(carriers, /ecomm\.one-line\.com\/one-ecom\/schedule\/vessel-schedule/);
  assert.match(carriers, /hmm21\.com\/e-service\/general\/schedule\/ScheduleMain\.do/);
  assert.match(carriers, /oocl\.com\/eng\/ourservices\/eservices\/trackandtrace/);
  assert.match(carriers, /yangming\.com\/en\/esolution\/schedule\/vessel_schedule/);
  assert.match(syncApi, /INSERT INTO shipment_schedule_history/);
  assert.match(dashboard, /船期变化记录/);
  assert.match(dashboard, /ETD 从/);
  assert.match(dashboard, /最终实际开船/);
  assert.match(shipmentApi, /export async function PATCH/);
  assert.match(shipmentApi, /SET archived_at = CASE/);
  assert.match(syncApi, /!shipment\.archivedAt/);
  assert.match(dashboard, /已归档船次/);
  assert.match(dashboard, /setShipmentArchived/);
  assert.match(syncApi, /const scheduleChanged/);
  assert.match(syncApi, /update\.baselineEtd/);
  assert.match(syncApi, /update\.baselineEta/);
  assert.match(syncApi, /if \(scheduleChanged\)/);
  assert.match(shipmentHistory, /sameSchedule/);
  assert.match(shipmentHistory, /初始船期/);
  assert.match(dashboard, /初始 ETD/);
  assert.match(dashboard, /ATD 实际开船/);
  assert.match(dashboard, /当前 ETA/);
  assert.match(dashboard, /条记录/);
  assert.match(shipmentApi, /baseline_etd AS baselineEtd/);
  assert.match(shipmentApi, /ORDER BY id DESC/);
  assert.match(syncApi, /ORDER BY id DESC/);
  assert.ok(
    dashboard.indexOf('className="row-button"') <
      dashboard.indexOf('className="archive-row-button"')
  );
  assert.match(dashboard, /shipment\.archivedAt \? "恢复" : "归档"/);
  assert.match(dashboard, /编辑订单信息/);
  assert.match(dashboard, /openEditShipment/);
  assert.match(dashboard, /action: "edit"/);
  assert.match(shipmentApi, /body\.action === "edit"/);
  assert.match(shipmentApi, /WHERE id = \?/);
  assert.match(shipmentApi, /trackingKeysChanged/);
  assert.match(carriers, /sharedCarrierFallbacks/);
  assert.match(carriers, /carrierId: "zim",[\s\S]*sourceCarrierIds: \["msc"\]/);
  assert.match(carriers, /Gemini Cooperation/);
  assert.match(carriers, /Ocean Alliance 共舱/);
  assert.match(carriers, /Premier Alliance 共舱/);
  assert.match(tracking, /crossCarrierScheduleMatches/);
  assert.match(tracking, /orderedPortPair/);
  assert.match(tracking, /crossCarrierScheduleDistance\(shipment, candidateEtd, candidateEta\) <= 35/);
  assert.match(tracking, /fallbackWinnerPromise/);
  assert.match(tracking, /Promise\.allSettled/);
  assert.match(tracking, /carrierQueries/);
  assert.match(tracking, /共舱回退/);
  assert.match(tracking, /voyage: shipment\.voyage/);
});
