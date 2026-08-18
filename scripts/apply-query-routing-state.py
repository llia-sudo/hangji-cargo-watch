from pathlib import Path


def patch(path: str, before: str, after: str, label: str) -> None:
    file = Path(path)
    content = file.read_text(encoding="utf-8")
    if after in content:
        return
    if before not in content:
        raise RuntimeError(f"Patch anchor not found in {path}: {label}")
    file.write_text(content.replace(before, after, 1), encoding="utf-8")


# Database schema: additive only, so an older app version remains compatible.
patch(
    "db/schema.ts",
    '''    delayDays: integer("delay_days").notNull().default(0),
    source: text("source").notNull().default("手工录入"),''',
    '''    delayDays: integer("delay_days").notNull().default(0),
    carrierId: text("carrier_id").notNull().default(""),
    preferredQuerySource: text("preferred_query_source").notNull().default(""),
    source: text("source").notNull().default("手工录入"),''',
    "add routing fields to shipment schema",
)

patch(
    "db/schema.ts",
    '''export const authAttempts = sqliteTable("auth_attempts", {''',
    '''export const vesselQueryProfiles = sqliteTable(
  "vessel_query_profiles",
  {
    vesselName: text("vessel_name").notNull(),
    portOfLoading: text("port_of_loading").notNull().default(""),
    portOfDischarge: text("port_of_discharge").notNull().default(""),
    carrierId: text("carrier_id").notNull().default(""),
    preferredQuerySource: text("preferred_query_source").notNull().default(""),
    successCount: integer("success_count").notNull().default(0),
    lastVerifiedAt: text("last_verified_at").notNull().default(""),
  },
  (table) => [
    uniqueIndex("vessel_query_profiles_route_unique").on(
      table.vesselName,
      table.portOfLoading,
      table.portOfDischarge
    ),
    index("idx_vessel_query_profiles_source").on(table.preferredQuerySource),
  ]
);

export const authAttempts = sqliteTable("auth_attempts", {''',
    "add vessel query profile schema",
)

patch(
    "db/index.ts",
    '''            delay_days INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT '手工录入',''',
    '''            delay_days INTEGER NOT NULL DEFAULT 0,
            carrier_id TEXT NOT NULL DEFAULT '',
            preferred_query_source TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '手工录入',''',
    "add routing columns to new shipment tables",
)

patch(
    "db/index.ts",
    '''        d1.prepare(`
          CREATE INDEX IF NOT EXISTS idx_shipment_schedule_history_shipment_checked
          ON shipment_schedule_history(shipment_id, checked_at)
        `),
        d1.prepare("PRAGMA optimize"),''',
    '''        d1.prepare(`
          CREATE INDEX IF NOT EXISTS idx_shipment_schedule_history_shipment_checked
          ON shipment_schedule_history(shipment_id, checked_at)
        `),
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS vessel_query_profiles (
            vessel_name TEXT NOT NULL,
            port_of_loading TEXT NOT NULL DEFAULT '',
            port_of_discharge TEXT NOT NULL DEFAULT '',
            carrier_id TEXT NOT NULL DEFAULT '',
            preferred_query_source TEXT NOT NULL DEFAULT '',
            success_count INTEGER NOT NULL DEFAULT 0,
            last_verified_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (vessel_name, port_of_loading, port_of_discharge)
          )
        `),
        d1.prepare(`
          CREATE INDEX IF NOT EXISTS idx_vessel_query_profiles_source
          ON vessel_query_profiles(preferred_query_source)
        `),
        d1.prepare("PRAGMA optimize"),''',
    "create routing profile table",
)

patch(
    "db/index.ts",
    '''        if (!columnNames.has("baseline_eta")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN baseline_eta TEXT NOT NULL DEFAULT ''")
            .run();
        }
        await d1.prepare(`''',
    '''        if (!columnNames.has("baseline_eta")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN baseline_eta TEXT NOT NULL DEFAULT ''")
            .run();
        }
        if (!columnNames.has("carrier_id")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN carrier_id TEXT NOT NULL DEFAULT ''")
            .run();
        }
        if (!columnNames.has("preferred_query_source")) {
          await d1
            .prepare("ALTER TABLE shipments ADD COLUMN preferred_query_source TEXT NOT NULL DEFAULT ''")
            .run();
        }
        await d1.prepare(`''',
    "add routing columns to existing D1",
)

# Shipment API selects the routing state and clears it if sailing identity changes.
for file in ["app/api/shipments/route.ts", "app/api/shipments/sync/route.ts"]:
    patch(
        file,
        '''    delay_days AS delayDays,
    source,''',
        '''    delay_days AS delayDays,
    carrier_id AS carrierId,
    preferred_query_source AS preferredQuerySource,
    source,''',
        f"select routing fields in {file}",
    )

patch(
    "app/api/shipments/route.ts",
    '''        status = excluded.status,
        baseline_etd = CASE''',
    '''        status = excluded.status,
        carrier_id = CASE
          WHEN shipments.vessel_name <> excluded.vessel_name
            OR shipments.voyage <> excluded.voyage
            OR shipments.port_of_loading <> excluded.port_of_loading
            OR shipments.port_of_discharge <> excluded.port_of_discharge
          THEN '' ELSE shipments.carrier_id
        END,
        preferred_query_source = CASE
          WHEN shipments.vessel_name <> excluded.vessel_name
            OR shipments.voyage <> excluded.voyage
            OR shipments.port_of_loading <> excluded.port_of_loading
            OR shipments.port_of_discharge <> excluded.port_of_discharge
          THEN '' ELSE shipments.preferred_query_source
        END,
        baseline_etd = CASE''',
    "clear learned routing on imported sailing identity change",
)

patch(
    "app/api/shipments/route.ts",
    '''            etd = ?,
            atd = CASE WHEN ? = 1 THEN '' ELSE atd END,''',
    '''            etd = ?,
            carrier_id = CASE WHEN ? = 1 THEN '' ELSE carrier_id END,
            preferred_query_source = CASE WHEN ? = 1 THEN '' ELSE preferred_query_source END,
            atd = CASE WHEN ? = 1 THEN '' ELSE atd END,''',
    "clear routing on manual sailing identity change",
)

patch(
    "app/api/shipments/route.ts",
    '''          row.etd,
          sailingIdentityChanged ? 1 : 0,
          row.eta,''',
    '''          row.etd,
          sailingIdentityChanged ? 1 : 0,
          sailingIdentityChanged ? 1 : 0,
          sailingIdentityChanged ? 1 : 0,
          row.eta,''',
    "bind routing reset flags",
)

# Tracking types carry routing state without forcing every carrier adapter to populate it.
patch(
    "app/lib/tracking.ts",
    '''  orderNo: string;
  vesselName: string;''',
    '''  orderNo: string;
  carrierId?: string;
  preferredQuerySource?: string;
  vesselName: string;''',
    "add routing state to tracking shipment",
)

patch(
    "app/lib/tracking.ts",
    '''  | "vesselName"
  | "voyage"''',
    '''  | "carrierId"
  | "preferredQuerySource"
  | "vesselName"
  | "voyage"''',
    "add optional routing state to tracking update",
)

patch(
    "app/lib/tracking.ts",
    '''        "source" | "sourceUrl" | "lastCheckedAt" | "notes"
      >;''',
    '''        "carrierId" | "preferredQuerySource" | "source" | "sourceUrl" | "lastCheckedAt" | "notes"
      >;''',
    "allow routing state on identified results",
)

patch(
    "app/lib/tracking.ts",
    '''        "source" | "sourceUrl" | "lastCheckedAt" | "notes"
      >;
    };''',
    '''        "carrierId" | "preferredQuerySource" | "source" | "sourceUrl" | "lastCheckedAt" | "notes"
      >;
    };''',
    "allow routing state on checked results",
)

# Lightweight official vessel probes before full schedule queries for unknown vessels.
patch(
    "app/lib/tracking.ts",
    '''async function discoverUnknownCarrierByOfficialSchedule(
  shipment: TrackingShipment,
  session: TrackingSession
) {''',
    '''async function officialSourceRecognizesVessel(
  carrier: Carrier,
  shipment: TrackingShipment,
  session: TrackingSession
) {
  if (!shipment.vesselName) return false;
  const vesselKey = identifier(shipment.vesselName);
  try {
    switch (carrier.id) {
      case "cosco":
        await findCoscoVesselCode(shipment.vesselName, session);
        return true;
      case "one":
        await findOneVesselCode(shipment.vesselName, session);
        return true;
      case "hmm":
        return (await loadHmmVessels(session)).some(
          (item) => identifier(item.optNm ?? "") === vesselKey
        );
      case "yang-ming": {
        if (!session.yangMingVessels) {
          session.yangMingVessels = yangMingGet<YangMingVessel[]>("GetVessels");
          session.yangMingVessels.catch(() => { session.yangMingVessels = undefined; });
        }
        return (await session.yangMingVessels).some(
          (item) => identifier(item.vesselName ?? "") === vesselKey
        );
      }
      case "maersk":
        return (await loadMaerskVessels(session)).some(
          (item) => identifier(item.vesselName ?? "") === vesselKey
        );
      case "sinotrans":
        return Boolean(await findSinotransVessel(shipment));
      default:
        return false;
    }
  } catch {
    return false;
  }
}

async function discoverUnknownCarrierByOfficialSchedule(
  shipment: TrackingShipment,
  session: TrackingSession
) {''',
    "add lightweight official vessel probes",
)

patch(
    "app/lib/tracking.ts",
    '''  const attempts = candidates.map(async (sourceCarrier) => {
    const update = await cachedCarrierQuery(sourceCarrier, shipment, session, {
      allowVoyageAlias: false,
      sourceCarrier,
    });
    return { carrier: sourceCarrier, update };
  });''',
    '''  const attempts = candidates.map(async (sourceCarrier) => {
    if (!await officialSourceRecognizesVessel(sourceCarrier, shipment, session)) {
      throw new Error(`${sourceCarrier.shortName} 官方船名库未命中`);
    }
    const update = await cachedCarrierQuery(sourceCarrier, shipment, session, {
      allowVoyageAlias: false,
      sourceCarrier,
    });
    return { carrier: sourceCarrier, update };
  });''',
    "only run full schedule query after vessel probe matches",
)

# Use the persisted preferred source field first; old source text remains a backward-compatible fallback.
patch(
    "app/lib/tracking.ts",
    '''    const persistedQuerySource = detectQuerySourceCarrier(shipment.source);
    if (
      persistedQuerySource &&
      persistedQuerySource.id !== carrier.id &&
      supportsAutomaticCarrierQuery(persistedQuerySource) &&
      /回退/.test(shipment.source)
    ) {''',
    '''    const persistedQuerySource =
      (shipment.preferredQuerySource
        ? carriers.find((item) => item.id === shipment.preferredQuerySource)
        : undefined) ??
      (/回退/.test(shipment.source)
        ? detectQuerySourceCarrier(shipment.source)
        : undefined);
    if (
      persistedQuerySource &&
      persistedQuerySource.id !== carrier.id &&
      supportsAutomaticCarrierQuery(persistedQuerySource)
    ) {''',
    "read preferred source from dedicated field",
)

patch(
    "app/lib/tracking.ts",
    '''          update: {
            ...preferredUpdate,
            voyage: shipment.voyage,
            source: `${preferredUpdate.source}（智能回退）`,''',
    '''          update: {
            ...preferredUpdate,
            carrierId: carrier.id,
            preferredQuerySource: persistedQuerySource.id,
            voyage: shipment.voyage,
            source: `${preferredUpdate.source}（智能回退）`,''',
    "persist remembered fast source metadata",
)

# Unknown official match persists identity and preferred source.
patch(
    "app/lib/tracking.ts",
    '''          update: {
            ...first.value.update,
            notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${first.value.update.notes}`,''',
    '''          update: {
            ...first.value.update,
            carrierId: carrier.id,
            preferredQuerySource: carrier.id,
            notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${first.value.update.notes}`,''',
    "persist first official discovery routing",
)

patch(
    "app/lib/tracking.ts",
    '''            update: {
              ...officialMatch.update,
              notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${officialMatch.update.notes}`,''',
    '''            update: {
              ...officialMatch.update,
              carrierId: carrier.id,
              preferredQuerySource: carrier.id,
              notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${officialMatch.update.notes}`,''',
    "persist delayed official discovery routing",
)

# Primary success routing.
patch(
    "app/lib/tracking.ts",
    '''        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `${update.source} 查询成功`,
          update,
        };''',
    '''        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `${update.source} 查询成功`,
          update: {
            ...update,
            carrierId: carrier.id,
            preferredQuerySource: carrier.id,
          },
        };''',
    "persist primary routing",
)

# Fallback success routing.
patch(
    "app/lib/tracking.ts",
    '''        const update: TrackingUpdate = {
          ...winner.update,
          // The order keeps the customer's voyage number.''',
    '''        const update: TrackingUpdate = {
          ...winner.update,
          carrierId: carrier.id,
          preferredQuerySource: winner.sourceCarrier.id,
          // The order keeps the customer's voyage number.''',
    "persist fallback routing",
)

# Identification without automatic source still persists carrier identity.
patch(
    "app/lib/tracking.ts",
    '''        identification: {
          source: `${carrier.shortName}（${method}）`,''',
    '''        identification: {
          carrierId: carrier.id,
          preferredQuerySource: carrier.id,
          source: `${carrier.shortName}（${method}）`,''',
    "persist identified carrier identity",
)

# Sync API: load learned route profiles before network calls.
patch(
    "app/api/shipments/sync/route.ts",
    '''function subtractDays(value: string, days: number) {''',
    '''function routingKey(vesselName?: string, pol?: string, pod?: string) {
  return [vesselName, pol, pod]
    .map((value) => (value ?? "").trim().toUpperCase())
    .join("|");
}

function subtractDays(value: string, days: number) {''',
    "add routing profile key helper",
)

patch(
    "app/api/shipments/sync/route.ts",
    '''    const current = await d1.prepare(selectSql).all<TrackingShipment>();
    const allShipments = current.results ?? [];
    const shipments = (requestedOrderNo''',
    '''    const current = await d1.prepare(selectSql).all<TrackingShipment>();
    const profileRows = await d1.prepare(`
      SELECT vessel_name AS vesselName,
             port_of_loading AS portOfLoading,
             port_of_discharge AS portOfDischarge,
             carrier_id AS carrierId,
             preferred_query_source AS preferredQuerySource
      FROM vessel_query_profiles
    `).all<{
      vesselName: string;
      portOfLoading: string;
      portOfDischarge: string;
      carrierId: string;
      preferredQuerySource: string;
    }>();
    const profileMap = new Map(
      (profileRows.results ?? []).map((profile) => [
        routingKey(profile.vesselName, profile.portOfLoading, profile.portOfDischarge),
        profile,
      ])
    );
    const allShipments = (current.results ?? []).map((shipment) => {
      const profile = profileMap.get(
        routingKey(shipment.vesselName, shipment.portOfLoading, shipment.portOfDischarge)
      );
      return {
        ...shipment,
        carrierId: shipment.carrierId || profile?.carrierId || "",
        preferredQuerySource:
          shipment.preferredQuerySource || profile?.preferredQuerySource || "",
      };
    });
    const shipments = (requestedOrderNo''',
    "hydrate routing state from learned vessel profiles",
)

# Successful sync writes routing fields to shipment row.
patch(
    "app/api/shipments/sync/route.ts",
    '''                delay_days = ?,
                source = ?,''',
    '''                delay_days = ?,
                carrier_id = ?,
                preferred_query_source = ?,
                source = ?,''',
    "write routing fields on successful sync",
)

patch(
    "app/api/shipments/sync/route.ts",
    '''                update.delayDays,
                update.source,
                update.sourceUrl,''',
    '''                update.delayDays,
                update.carrierId || before.carrierId || "",
                update.preferredQuerySource || update.carrierId || before.preferredQuerySource || before.carrierId || "",
                update.source,
                update.sourceUrl,''',
    "bind routing fields on successful sync",
)

# Add route-learning profile upsert to each successful result.
patch(
    "app/api/shipments/sync/route.ts",
    '''            if (scheduleChanged) {
              statements.push(d1.prepare(`''',
    '''            const learnedCarrierId = update.carrierId || before.carrierId || "";
            const learnedSource =
              update.preferredQuerySource || learnedCarrierId || before.preferredQuerySource || "";
            if (update.vesselName && learnedSource) {
              statements.push(d1.prepare(`
                INSERT INTO vessel_query_profiles (
                  vessel_name, port_of_loading, port_of_discharge,
                  carrier_id, preferred_query_source, success_count, last_verified_at
                ) VALUES (?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT(vessel_name, port_of_loading, port_of_discharge)
                DO UPDATE SET
                  carrier_id = excluded.carrier_id,
                  preferred_query_source = excluded.preferred_query_source,
                  success_count = vessel_query_profiles.success_count + 1,
                  last_verified_at = excluded.last_verified_at
              `).bind(
                update.vesselName.trim().toUpperCase(),
                update.portOfLoading.trim().toUpperCase(),
                update.portOfDischarge.trim().toUpperCase(),
                learnedCarrierId,
                learnedSource,
                update.lastCheckedAt
              ));
            }
            if (scheduleChanged) {
              statements.push(d1.prepare(`''',
    "learn successful vessel route source",
)

# Identified-only result stores carrier identity.
patch(
    "app/api/shipments/sync/route.ts",
    '''                UPDATE shipments SET
                  source = ?,''',
    '''                UPDATE shipments SET
                  carrier_id = CASE WHEN ? <> '' THEN ? ELSE carrier_id END,
                  preferred_query_source = CASE WHEN ? <> '' THEN ? ELSE preferred_query_source END,
                  source = ?,''',
    "write routing fields on identification",
)

patch(
    "app/api/shipments/sync/route.ts",
    '''              .bind(
                identification.source,
                identification.sourceUrl,''',
    '''              .bind(
                identification.carrierId || "",
                identification.carrierId || "",
                identification.preferredQuerySource || "",
                identification.preferredQuerySource || "",
                identification.source,
                identification.sourceUrl,''',
    "bind identification routing fields",
)

# Tests assert additive schema, learned routing and lightweight probe path.
patch(
    "tests/cargo-watch.test.mjs",
    '''    readFile(new URL("drizzle/0004_baseline_schedule.sql", root), "utf8"),
  ]);''',
    '''    readFile(new URL("drizzle/0004_baseline_schedule.sql", root), "utf8"),
    readFile(new URL("drizzle/0005_query_routing.sql", root), "utf8"),
  ]);''',
    "load query routing migration in tests",
)

# The Promise.all destructuring needs one more name.
patch(
    "tests/cargo-watch.test.mjs",
    '''  const [hosting, schema, migration, historyMigration, archiveMigration, baselineMigration] = await Promise.all([''',
    '''  const [hosting, schema, migration, historyMigration, archiveMigration, baselineMigration, routingMigration] = await Promise.all([''',
    "name routing migration fixture",
)

patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(baselineMigration, /baseline_eta/);
});''',
    '''  assert.match(baselineMigration, /baseline_eta/);
  assert.match(schema, /carrierId/);
  assert.match(schema, /preferredQuerySource/);
  assert.match(schema, /vesselQueryProfiles/);
  assert.match(routingMigration, /vessel_query_profiles/);
  assert.match(routingMigration, /preferred_query_source/);
});''',
    "assert additive routing schema",
)

patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(tracking, /discoverUnknownCarrierByOfficialSchedule/);''',
    '''  assert.match(tracking, /discoverUnknownCarrierByOfficialSchedule/);
  assert.match(tracking, /officialSourceRecognizesVessel/);
  assert.match(tracking, /preferredQuerySource/);
  assert.match(syncApi, /vessel_query_profiles/);
  assert.match(syncApi, /profileMap/);
  assert.match(syncApi, /success_count = vessel_query_profiles\.success_count \+ 1/);''',
    "assert lightweight discovery and learned route state",
)

print("Query routing state patches applied successfully.")
