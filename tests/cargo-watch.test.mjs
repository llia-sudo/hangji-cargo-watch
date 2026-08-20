import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createLianyungangSession,
  LianyungangSourceError,
  parseLianyungangActualDeparture,
  parseLianyungangPlannedDeparture,
  queryLianyungangActualDeparture,
  queryLianyungangPlannedDeparture,
} from "../app/lib/ports/lianyungang.ts";
import {
  discoverAndDispatchCarrier,
  hasPartialScheduleSuccess,
  isLianyungangPort,
  lianyungangScheduleStatus,
  mergeLianyungangFields,
  routeShipmentQuery,
  settleLianyungangSources,
} from "../app/lib/tracking-orchestration.ts";

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
  const [hosting, schema, migration, historyMigration, archiveMigration, baselineMigration, routingMigration] = await Promise.all([
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0000_create_shipments.sql", root), "utf8"),
    readFile(new URL("drizzle/0002_shipment_schedule_history.sql", root), "utf8"),
    readFile(new URL("drizzle/0003_archive_shipments.sql", root), "utf8"),
    readFile(new URL("drizzle/0004_baseline_schedule.sql", root), "utf8"),
    readFile(new URL("drizzle/0005_query_routing.sql", root), "utf8"),
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
  assert.match(schema, /carrierId/);
  assert.match(schema, /preferredQuerySource/);
  assert.match(schema, /vesselQueryProfiles/);
  assert.match(routingMigration, /vessel_query_profiles/);
  assert.match(routingMigration, /preferred_query_source/);
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
  assert.match(dashboard, /船期查询使用说明/);
  assert.doesNotMatch(dashboard, /全球前十大班轮公司/);
  assert.match(dashboard, /船公司<\/span><select/);
  assert.doesNotMatch(dashboard, /未知船公司识别/);
  assert.doesNotMatch(dashboard, /source-network-grid/);
  assert.match(dashboard, /系统自动识别船公司，并查询对应船公司官网船期/);
  assert.match(dashboard, /信息越完整，查询越准确。填写箱号\/提单号可以提高准确性。/);
  assert.match(dashboard, /查询结果以船公司官网信息为主，实际港口动态可能更新更快，请结合港口信息核对。/);
  assert.match(carriers, /vesselName: "CONCERTO"/);
  assert.match(carriers, /vesselName: "REN JIAN 27"/);
  assert.match(carriers, /carrierId: "sinotrans"/);
  assert.match(carriers, /e-sinokor\.com\/Schedule\/vsl-schedule/);
  assert.match(carriers, /Sinotrans Container Lines/);
  assert.match(carriers, /ebusiness\.sinolines\.com\.cn\/Ebusiness\/EQUERY\/QuerySchedule\.aspx/);
  assert.match(carriers, /SHANGHAI INCHON INTERNATIONAL FERRY/);
  assert.match(onlineIdentification, /https:\/\/search\.brave\.com\/search/);
  assert.match(onlineIdentification, /officialEvidence/);
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
  assert.match(tracking, /COSCO 官网返回 \${rows.length} 条船期记录/);
  assert.match(tracking, /没有目标航次/);
  assert.match(tracking, /没有匹配 \${shipment.portOfLoading} → \${shipment.portOfDischarge}/);
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
  assert.match(tracking, /discoverUnknownCarrierByOfficialSchedule/);
  assert.match(tracking, /officialSourceRecognizesVessel/);
  assert.match(tracking, /preferredQuerySource/);
  assert.match(syncApi, /vessel_query_profiles/);
  assert.match(syncApi, /profileMap/);
  assert.match(syncApi, /success_count = vessel_query_profiles\.success_count \+ 1/);
  assert.match(tracking, /candidateIds = \["cosco", "one", "hmm", "yang-ming", "maersk", "sinotrans"\]/);
  assert.doesNotMatch(tracking, /carrier = sinotransVessel/);
  assert.match(tracking, /persistedQuerySource/);
  assert.match(tracking, /沿用上次成功的/);
  assert.match(tracking, /TrackingFailureCategory/);
  assert.match(tracking, /primaryFailureCategory/);
  assert.match(tracking, /shouldRememberFallback/);
  assert.match(tracking, /沿用已验证船名航线记录/);
  assert.doesNotMatch(syncApi, /shipment\.carrierId \|\| profile\?\.carrierId/);
  assert.match(tracking, /queryOne/);
  assert.match(tracking, /queryHmm/);
  assert.match(tracking, /data\.RTN_DATA\?\.boardList \?\? data\.boardList/);
  assert.match(tracking, /hmmVoyageFamily/);
  assert.match(tracking, /allowDepartureOnly/);
  assert.match(tracking, /目的港信息不符/);
  assert.match(tracking, /ETA\/ATA 未由该海运挂港表验证/);
  assert.match(tracking, /portOfDischarge: pair/);
  assert.match(dashboard, /function departureShiftDays/);
  assert.match(dashboard, /function arrivalShiftDays/);
  assert.match(dashboard, /shipmentHasScheduleDelay/);
  assert.match(dashboard, /hasPortMismatchWarning/);
  assert.match(dashboard, /shipment\.atd \? "晚开" : "延后"/);
  assert.match(dashboard, /shipment\.ata \? "晚到" : "延后"/);
  assert.doesNotMatch(dashboard, /晚 \{shipment\.delayDays\} 天/);
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
  assert.doesNotMatch(dashboard, /<strong>Maersk<\/strong>/);
  assert.doesNotMatch(dashboard, /需授权/);
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
  assert.match(carriers, /normalizeSource/);
  assert.match(carriers, /Boolean\(aliasKey && sourceKey\.includes\(aliasKey\)\)/);
  assert.match(carriers, /detectQuerySourceCarrier/);
  assert.match(carriers, /sourceKey === shortNameKey/);
  assert.match(carriers, /sourceKey === aliasKey/);
  assert.ok(
    carriers.indexOf("if (container)") < carriers.indexOf("return carrierFromSource(input.source)")
  );
  assert.match(shipmentApi, /sailingIdentityChanged/);
  assert.match(shipmentApi, /atd = CASE WHEN \? = 1 THEN '' ELSE atd END/);
  assert.match(shipmentApi, /ata = CASE WHEN \? = 1 THEN '' ELSE ata END/);
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

test("desktop shipment UI uses readable route and detail typography", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("app/TrackerApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(dashboard, /route-warning/);
  assert.match(dashboard, />→<\/i>/);
  assert.match(dashboard, /海运挂港不符/);
  assert.match(css, /Desktop readability refresh 2026-08-18/);
  assert.match(css, /\.orders-panel th[\s\S]*font-size: 11\.5px/);
  assert.match(css, /\.orders-panel td[\s\S]*font-size: 13px/);
  assert.match(css, /\.route-cell b[\s\S]*font-size: 12\.5px/);
  assert.match(css, /\.detail-drawer[\s\S]*width: min\(540px, 100%\)/);
  assert.match(css, /\.detail-drawer \.detail-section dd[\s\S]*font-size: 13\.5px/);
  assert.match(css, /\.detail-drawer \.date-comparison-row strong[\s\S]*font-size: 18px/);
});

test("expired ETD without ATD is shown as estimated in transit", async () => {
  const [tracking, dashboard, css] = await Promise.all([
    readFile(new URL("app/lib/tracking.ts", root), "utf8"),
    readFile(new URL("app/TrackerApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(tracking, /return "预计运输中"/);
  assert.match(tracking, /status: scheduleStatus\(etd, atd, eta, ata\)/);
  assert.match(dashboard, /status === "运输中" \|\| status === "预计运输中"/);
  assert.match(dashboard, /ATD 待确认/);
  assert.match(dashboard, /尚未取得实际开船 ATD/);
  assert.match(dashboard, /panel-primary-actions/);
  assert.match(dashboard, /导入 Excel/);
  assert.match(dashboard, /新增订单/);
  assert.doesNotMatch(dashboard, /className="hero-actions"/);
  assert.match(css, /Current sailings actions and estimated transit 2026-08-18/);
  assert.match(css, /\.panel-primary-actions \.button/);
});

test("carrier-specific schedule status uses estimated in transit", async () => {
  const tracking = await readFile(new URL("app/lib/tracking.ts", root), "utf8");
  assert.match(
    tracking,
    /export async function querySinotrans[\s\S]*?status: scheduleStatus\(etd, atd, eta, ata\),[\s\S]*?source: "中外运集运官网船期"/
  );
  assert.match(
    tracking,
    /async function queryPancon[\s\S]*?const status = scheduleStatus\(etd, atd, eta, ata\);[\s\S]*?source: "PANCON 官网船期"/
  );
  assert.match(
    tracking,
    /async function queryCoscoGlobal[\s\S]*?const status = scheduleStatus\(etd, atd, eta, ata\);[\s\S]*?source: "COSCO eLines 全球官网船期"/
  );
});

test("Lianyungang adapter submits the real Tapestry forms and matches exact vessel plus voyage", async () => {
  const [plannedHtml, actualHtml] = await Promise.all([
    readFile(new URL("fixtures/lygedi-planned.html", import.meta.url), "utf8"),
    readFile(new URL("fixtures/lygedi-actual.html", import.meta.url), "utf8"),
  ]);
  assert.equal(
    parseLianyungangPlannedDeparture(plannedHtml, "TEST VESSEL", "002-W"),
    "2026-08-03 10:30"
  );
  assert.equal(
    parseLianyungangActualDeparture(actualHtml, " test vessel ", "002W"),
    "2026-08-05 14:30"
  );
  assert.throws(
    () => parseLianyungangPlannedDeparture(plannedHtml, "TEST", "002W"),
    (error) =>
      error instanceof LianyungangSourceError &&
      error.code === "VESSEL_NOT_FOUND"
  );
  assert.throws(
    () =>
      parseLianyungangActualDeparture(
        actualHtml,
        "TEST VESSEL",
        "NO-SUCH-VOYAGE"
      ),
    (error) =>
      error instanceof LianyungangSourceError &&
      error.code === "VOYAGE_NOT_FOUND"
  );

  const plannedCalls = [];
  const plannedFetch = async (url, init = {}) => {
    plannedCalls.push({ url, init });
    return new Response(plannedHtml, { status: 200 });
  };
  const plannedSession = createLianyungangSession();
  const planned = await queryLianyungangPlannedDeparture(
    { vesselName: "TEST VESSEL", voyage: "002W" },
    plannedSession,
    plannedFetch
  );
  assert.equal(planned.departure, "2026-08-03 10:30");
  assert.equal(plannedCalls.length, 2);
  assert.equal(plannedCalls[0].init.method, undefined);
  assert.equal(plannedCalls[1].init.method, "POST");
  const plannedBody = new URLSearchParams(String(plannedCalls[1].init.body));
  assert.equal(plannedBody.get("$TextField$1"), "TEST VESSEL");
  assert.equal(plannedBody.get("_linkSubmit"), "$LinkSubmit$1");
  assert.deepEqual(plannedBody.getAll("$ListEdit"), [
    "first-state",
    "second-state",
  ]);
  await queryLianyungangPlannedDeparture(
    { vesselName: "TEST VESSEL", voyage: "002W" },
    plannedSession,
    plannedFetch
  );
  assert.equal(plannedCalls.length, 2, "same batch query should be cached");

  const actualCalls = [];
  const actual = await queryLianyungangActualDeparture(
    { vesselName: "TEST VESSEL", voyage: "002W" },
    createLianyungangSession(),
    async (url, init = {}) => {
      actualCalls.push({ url, init });
      return new Response(actualHtml, { status: 200 });
    }
  );
  assert.equal(actual.departure, "2026-08-05 14:30");
  const actualBody = new URLSearchParams(String(actualCalls[1].init.body));
  assert.equal(actualBody.get("textField2"), "TEST VESSEL");
  assert.equal(actualBody.get("$Submit"), "查询");
});

test("CASE 1: Lianyungang uses port ETD/ATD and carrier ETA/ATA", () => {
  const fields = mergeLianyungangFields({
    plannedEtd: "2026-08-03",
    actualAtd: "2026-08-05",
    carrier: {
      etd: "2099-01-01",
      atd: "2099-01-02",
      eta: "2026-08-10",
      ata: "2026-08-11",
    },
  });
  assert.deepEqual(fields, {
    etd: "2026-08-03",
    atd: "2026-08-05",
    eta: "2026-08-10",
    ata: "2026-08-11",
  });
});

test("CASE 2: missing Lianyungang ATD and carrier ATA remains a partial success", () => {
  const fields = mergeLianyungangFields({
    plannedEtd: "2026-08-03",
    carrier: { eta: "2026-08-10" },
  });
  assert.deepEqual(fields, {
    etd: "2026-08-03",
    atd: "",
    eta: "2026-08-10",
    ata: "",
  });
  assert.equal(
    hasPartialScheduleSuccess({
      portSucceeded: true,
      carrierSucceeded: true,
    }),
    true
  );
  assert.equal(
    lianyungangScheduleStatus(fields, "2026-08-04 12:00"),
    "运输中"
  );
  assert.equal(
    lianyungangScheduleStatus(fields, "2026-08-02 12:00"),
    "待开船"
  );
  assert.equal(
    lianyungangScheduleStatus(
      { ...fields, etd: "2026-08-01", eta: "" },
      "2026-08-04 12:00"
    ),
    "运输中"
  );
});

test("CASE 3: carrier ETD/ATD can never overwrite Lianyungang fields", () => {
  const fields = mergeLianyungangFields({
    plannedEtd: "2026-08-03",
    actualAtd: "2026-08-05",
    carrier: {
      etd: "2026-08-30",
      atd: "2026-08-31",
      eta: "2026-09-10",
      ata: "2026-09-11",
    },
  });
  assert.equal(fields.etd, "2026-08-03");
  assert.equal(fields.atd, "2026-08-05");
});

test("CASE 4: carrier failure does not erase successful Lianyungang departure data", () => {
  const fields = mergeLianyungangFields({
    plannedEtd: "2026-08-03",
    actualAtd: "2026-08-05",
  });
  assert.deepEqual(fields, {
    etd: "2026-08-03",
    atd: "2026-08-05",
    eta: "",
    ata: "",
  });
  assert.equal(
    hasPartialScheduleSuccess({
      portSucceeded: true,
      carrierSucceeded: false,
    }),
    true
  );
});

test("CASE 5: non-Lianyungang shipments never call the port adapter", async () => {
  let portCalls = 0;
  let carrierCalls = 0;
  const result = await routeShipmentQuery(" Shanghai ", {
    lianyungang: async () => {
      portCalls += 1;
      return "port";
    },
    carrier: async () => {
      carrierCalls += 1;
      return "carrier";
    },
  });
  assert.equal(result, "carrier");
  assert.equal(portCalls, 0);
  assert.equal(carrierCalls, 1);
  assert.equal(isLianyungangPort(" lianyungang "), true);
  assert.equal(isLianyungangPort("LIANYUNGANG NEW PORT"), false);
});

test("CASE 6: Layer 1 success skips Layer 2 and Layer 3", async () => {
  const calls = [];
  const result = await discoverAndDispatchCarrier({
    layers: [
      async () => {
        calls.push("layer1");
        return "COSCO";
      },
      async () => {
        calls.push("layer2");
        return "ONE";
      },
      async () => {
        calls.push("layer3");
        return "HMM";
      },
    ],
    dispatch: async (carrier) => ({ carrier, schedule: "verified" }),
  });
  assert.deepEqual(calls, ["layer1"]);
  assert.equal(result.layer, 1);
  assert.equal(result.result.schedule, "verified");
});

test("CASE 7: Layer 2 success skips Layer 3", async () => {
  const calls = [];
  const result = await discoverAndDispatchCarrier({
    layers: [
      async () => {
        calls.push("layer1");
        return undefined;
      },
      async () => {
        calls.push("layer2");
        return "SINOTRANS";
      },
      async () => {
        calls.push("layer3");
        return "COSCO";
      },
    ],
    dispatch: async (carrier) => ({ carrier, schedule: "verified" }),
  });
  assert.deepEqual(calls, ["layer1", "layer2"]);
  assert.equal(result.layer, 2);
});

test("CASE 8: Layer 3 discovery dispatches an existing automatic adapter", async () => {
  const calls = [];
  const result = await discoverAndDispatchCarrier({
    layers: [
      async () => undefined,
      async () => undefined,
      async () => "COSCO",
    ],
    dispatch: async (carrier, layer) => {
      calls.push(`adapter:${carrier}:${layer}`);
      return { kind: "schedule", eta: "2026-08-10" };
    },
  });
  assert.deepEqual(calls, ["adapter:COSCO:3"]);
  assert.deepEqual(result.result, {
    kind: "schedule",
    eta: "2026-08-10",
  });
});

test("CASE 9: identified carrier without an adapter reports schedule unavailable", async () => {
  const result = await discoverAndDispatchCarrier({
    layers: [
      async () => undefined,
      async () => undefined,
      async () => "CARRIER_WITH_CAPTCHA",
    ],
    dispatch: async (carrier) => ({
      kind: "identified",
      carrier,
      error: "SCHEDULE_NOT_AVAILABLE",
    }),
  });
  assert.deepEqual(result.result, {
    kind: "identified",
    carrier: "CARRIER_WITH_CAPTCHA",
    error: "SCHEDULE_NOT_AVAILABLE",
  });
});

test("CASE 10: one timed-out source does not block other parallel results", async () => {
  const started = [];
  const pending = settleLianyungangSources({
    planned: async () => {
      started.push("planned");
      return "2026-08-03";
    },
    actual: async () => {
      started.push("actual");
      const error = new Error("timeout");
      error.name = "AbortError";
      throw error;
    },
    carrier: async () => {
      started.push("carrier");
      return { eta: "2026-08-10" };
    },
  });
  assert.deepEqual(started, ["planned", "actual", "carrier"]);
  const results = await pending;
  assert.equal(results.planned.status, "fulfilled");
  assert.equal(results.actual.status, "rejected");
  assert.equal(results.carrier.status, "fulfilled");
});
