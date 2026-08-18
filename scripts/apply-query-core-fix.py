from pathlib import Path


def patch(path: str, before: str, after: str, label: str) -> None:
    file = Path(path)
    content = file.read_text(encoding="utf-8")
    if after in content:
        return
    if before not in content:
        raise RuntimeError(f"Patch anchor not found in {path}: {label}")
    file.write_text(content.replace(before, after, 1), encoding="utf-8")


patch(
    "app/lib/carriers.ts",
    '''function carrierFromSource(source?: string) {
  const sourceKey = normalizeSource(source);
  if (!sourceKey) return undefined;
  const genericSources = new Set(["手工录入", "EXCEL导入", "自动识别"]);
  if (genericSources.has(sourceKey)) return undefined;
  const fallbackSource = sourceKey.includes("智能回退") || sourceKey.includes("共舱回退");
  if (fallbackSource) return undefined;
  return carriers.find((carrier) =>
    carrier.aliases.some((alias) => {
      const aliasKey = normalizeSource(alias);
      return Boolean(aliasKey && sourceKey.includes(aliasKey));
    })
  );
}''',
    '''export function detectQuerySourceCarrier(source?: string) {
  const sourceKey = normalizeSource(source);
  if (!sourceKey) return undefined;
  const genericSources = new Set(["手工录入", "EXCEL导入", "自动识别"]);
  if (genericSources.has(sourceKey)) return undefined;
  return carriers.find((carrier) =>
    carrier.aliases.some((alias) => {
      const aliasKey = normalizeSource(alias);
      return Boolean(aliasKey && sourceKey.includes(aliasKey));
    })
  );
}

function carrierFromSource(source?: string) {
  const sourceKey = normalizeSource(source);
  if (!sourceKey) return undefined;
  const fallbackSource = sourceKey.includes("智能回退") || sourceKey.includes("共舱回退");
  if (fallbackSource) return undefined;
  return detectQuerySourceCarrier(source);
}''',
    "separate carrier identity from persisted query source",
)

patch(
    "app/lib/tracking.ts",
    '''  carrierTrackingUrl,
  detectCarrier,
  sharedCarrierFallbackSources,''',
    '''  carrierTrackingUrl,
  detectCarrier,
  detectQuerySourceCarrier,
  sharedCarrierFallbackSources,''',
    "import query-source detector",
)

patch(
    "app/lib/tracking.ts",
    '''  const groups: CoscoGlobalSchedule[][] = [];
  for (const row of rows) {
    if (row.voy || !groups.length) groups.push([row]);
    else groups.at(-1)?.push(row);
  }
  const exactGroup = groups.find((group) =>
    (group[0]?.voy ?? "")
      .split("/")
      .some((voyage) => identifier(voyage) === voyageKey)
  );''',
    '''  const groups: CoscoGlobalSchedule[][] = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (!current) {
      groups.push([row]);
      continue;
    }
    const rowVoyage = row.voy?.trim() ?? "";
    const currentVoyage = current.find((item) => item.voy)?.voy?.trim() ?? "";
    // COSCO can repeat the same voyage on every port row. Repeating the same
    // voyage must not split one physical sailing into one-port groups.
    if (
      rowVoyage &&
      currentVoyage &&
      identifier(rowVoyage) !== identifier(currentVoyage)
    ) {
      groups.push([row]);
    } else {
      current.push(row);
    }
  }
  const exactGroup = groups.find((group) =>
    (group.find((row) => row.voy)?.voy ?? "")
      .split("/")
      .some((voyage) => identifier(voyage) === voyageKey)
  );''',
    "make COSCO voyage grouping tolerant of repeated voyage numbers",
)

patch(
    "app/lib/tracking.ts",
    '''  if (!voyageRows) {
    throw new Error("COSCO 全球官网已查询，但尚未发布相同船名航次或可信共舱别名");
  }''',
    '''  if (!voyageRows) {
    const returnedVoyages = Array.from(new Set(
      groups.flatMap((group) =>
        (group.find((row) => row.voy)?.voy ?? "")
          .split("/")
          .map((voyage) => voyage.trim())
          .filter(Boolean)
      )
    ));
    if (!exactGroup) {
      const sample = returnedVoyages.slice(0, 8).join("、");
      throw new Error(
        `COSCO 官网返回 ${rows.length} 条船期记录，但没有目标航次 ${shipment.voyage}${sample ? `；本次返回航次：${sample}` : ""}`
      );
    }
    throw new Error(
      `COSCO 官网已找到目标航次 ${shipment.voyage}，但没有匹配 ${shipment.portOfLoading} → ${shipment.portOfDischarge} 的有序港序`
    );
  }''',
    "add zero-request COSCO diagnostics",
)

patch(
    "app/lib/tracking.ts",
    '''function trackingErrorReason(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
    ? "船公司官网响应超时"
    : error instanceof Error
      ? error.message
      : "查询失败";
}''',
    '''type TrackingFailureCategory =
  | "TIMEOUT"
  | "VESSEL_NOT_FOUND"
  | "VOYAGE_NOT_FOUND"
  | "PORT_MISMATCH"
  | "REMOTE_ERROR"
  | "PARSE_ERROR"
  | "UNKNOWN";

function trackingErrorDetail(error: unknown): {
  category: TrackingFailureCategory;
  reason: string;
} {
  if (error instanceof Error && error.name === "AbortError") {
    return { category: "TIMEOUT", reason: "船公司官网响应超时" };
  }
  const reason = error instanceof Error ? error.message : "查询失败";
  if (/没有找到船名|船名库没有找到|无法识别船/i.test(reason)) {
    return { category: "VESSEL_NOT_FOUND", reason };
  }
  if (/没有相同航次|未找到相同船名航次|没有目标航次|未命中/i.test(reason)) {
    return { category: "VOYAGE_NOT_FOUND", reason };
  }
  if (/港序|启运港|目的港/i.test(reason)) {
    return { category: "PORT_MISMATCH", reason };
  }
  if (/返回 \\d{3}|服务器|官网返回/i.test(reason)) {
    return { category: "REMOTE_ERROR", reason };
  }
  if (/安全校验|没有返回船期数据|查询会话/i.test(reason)) {
    return { category: "PARSE_ERROR", reason };
  }
  return { category: "UNKNOWN", reason };
}

function trackingErrorReason(error: unknown) {
  return trackingErrorDetail(error).reason;
}

async function discoverUnknownCarrierByOfficialSchedule(
  shipment: TrackingShipment,
  session: TrackingSession
) {
  // Only completely unknown vessels fan out. Each candidate has to pass its
  // existing strict vessel + voyage + ordered POL/POD query. A vessel merely
  // appearing in one company's vessel list is not enough to claim the order.
  const candidateIds = ["cosco", "one", "hmm", "yang-ming", "maersk", "sinotrans"];
  const candidates = candidateIds
    .map((id) => carriers.find((carrier) => carrier.id === id))
    .filter((carrier): carrier is Carrier => Boolean(carrier));
  const attempts = candidates.map(async (sourceCarrier) => {
    const update = await cachedCarrierQuery(sourceCarrier, shipment, session, {
      allowVoyageAlias: false,
      sourceCarrier,
    });
    return { carrier: sourceCarrier, update };
  });
  const winner = Promise.any(attempts).catch(() => undefined);
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), 12_000)
  );
  return Promise.race([winner, timeout]);
}''',
    "classify failures and add strict official discovery",
)

patch(
    "app/lib/tracking.ts",
    '''    if (!carrier) {
      const onlineIdentificationPromise = findCarrierOnline(
        shipment,
        session
      ).catch(() => undefined);
      const sinotransVessel = await findSinotransVessel(shipment).catch(
        () => undefined
      );
      carrier = sinotransVessel
        ? carriers.find((item) => item.id === "sinotrans")
        : undefined;
      if (!carrier) {
        onlineIdentification = await onlineIdentificationPromise;
        carrier = onlineIdentification?.carrier;
      }
    }''',
    '''    if (!carrier) {
      const onlineIdentificationPromise = findCarrierOnline(
        shipment,
        session
      ).catch(() => undefined);
      const officialDiscoveryPromise = discoverUnknownCarrierByOfficialSchedule(
        shipment,
        session
      );
      const first = await Promise.race([
        onlineIdentificationPromise.then((value) => ({ type: "online" as const, value })),
        officialDiscoveryPromise.then((value) => ({ type: "official" as const, value })),
      ]);
      if (first.type === "official" && first.value) {
        carrier = first.value.carrier;
        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `官方船期交叉识别为 ${carrier.shortName}，查询成功`,
          update: {
            ...first.value.update,
            notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${first.value.update.notes}`,
          },
        };
      }
      if (first.type === "online" && first.value) {
        onlineIdentification = first.value;
        carrier = first.value.carrier;
      } else {
        const officialMatch = await officialDiscoveryPromise;
        if (officialMatch) {
          carrier = officialMatch.carrier;
          return {
            ok: true,
            orderNo: shipment.orderNo,
            message: `官方船期交叉识别为 ${carrier.shortName}，查询成功`,
            update: {
              ...officialMatch.update,
              notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${officialMatch.update.notes}`,
            },
          };
        }
        onlineIdentification = await onlineIdentificationPromise;
        carrier = onlineIdentification?.carrier;
      }
    }''',
    "remove Sinotrans-first unknown-carrier assignment",
)

patch(
    "app/lib/tracking.ts",
    '''    const fallback = sharedCarrierFallbackSources(carrier.id);''',
    '''    const persistedQuerySource = detectQuerySourceCarrier(shipment.source);
    if (
      persistedQuerySource &&
      persistedQuerySource.id !== carrier.id &&
      supportsAutomaticCarrierQuery(persistedQuerySource) &&
      /回退/.test(shipment.source)
    ) {
      try {
        const preferredUpdate = await cachedCarrierQuery(
          persistedQuerySource,
          shipment,
          session,
          {
            allowVoyageAlias: true,
            primaryCarrier: carrier,
            sourceCarrier: persistedQuerySource,
          }
        );
        const partnerVoyage = preferredUpdate.voyage;
        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `沿用上次成功的 ${persistedQuerySource.shortName} 快速查询源`,
          update: {
            ...preferredUpdate,
            voyage: shipment.voyage,
            source: `${preferredUpdate.source}（智能回退）`,
            notes: `快速查询：沿用上次成功来源 ${persistedQuerySource.shortName}${partnerVoyageNote(shipment.voyage, partnerVoyage)}。${preferredUpdate.notes}`,
          },
        };
      } catch {
        // Remembered fast source no longer works; continue with primary + normal fallbacks.
      }
    }

    const fallback = sharedCarrierFallbackSources(carrier.id);''',
    "reuse last successful fallback first",
)

patch(
    "app/api/shipments/route.ts",
    '''      const trackingKeysChanged = [
        "vesselName",
        "voyage",
        "billOfLading",
        "bookingNo",
        "containerNo",
        "portOfLoading",
        "portOfDischarge",
        "source",
      ].some((key) => {
        const field = key as keyof typeof existing;
        return String(existing[field] ?? "") !== String(row[key as keyof typeof row] ?? "");
      });''',
    '''      const trackingKeysChanged = [
        "vesselName",
        "voyage",
        "billOfLading",
        "bookingNo",
        "containerNo",
        "portOfLoading",
        "portOfDischarge",
        "source",
      ].some((key) => {
        const field = key as keyof typeof existing;
        return String(existing[field] ?? "") !== String(row[key as keyof typeof row] ?? "");
      });
      const sailingIdentityChanged = [
        "vesselName",
        "voyage",
        "portOfLoading",
        "portOfDischarge",
      ].some((key) => {
        const field = key as keyof typeof existing;
        return String(existing[field] ?? "") !== String(row[key as keyof typeof row] ?? "");
      });''',
    "detect sailing identity edits",
)

patch(
    "app/api/shipments/route.ts",
    '''            etd = ?,
            baseline_eta = CASE
              WHEN baseline_eta = '' AND ? <> '' THEN ?
              ELSE baseline_eta
            END,
            eta = ?,
            source = ?,''',
    '''            etd = ?,
            atd = CASE WHEN ? = 1 THEN '' ELSE atd END,
            baseline_eta = CASE
              WHEN baseline_eta = '' AND ? <> '' THEN ?
              ELSE baseline_eta
            END,
            eta = ?,
            ata = CASE WHEN ? = 1 THEN '' ELSE ata END,
            source = ?,''',
    "clear actual timestamps after sailing identity edits",
)

patch(
    "app/api/shipments/route.ts",
    '''          row.etd,
          row.eta,
          row.eta,
          row.eta,
          row.source,''',
    '''          row.etd,
          sailingIdentityChanged ? 1 : 0,
          row.eta,
          row.eta,
          row.eta,
          sailingIdentityChanged ? 1 : 0,
          row.source,''',
    "bind sailing reset flags",
)

patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(tracking, /尚未发布相同船名航次/);''',
    '''  assert.match(tracking, /COSCO 官网返回 \\${rows.length} 条船期记录/);
  assert.match(tracking, /没有目标航次/);
  assert.match(tracking, /没有匹配 \\${shipment.portOfLoading} → \\${shipment.portOfDischarge}/);''',
    "update COSCO diagnostic expectations",
)

patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(tracking, /中外运官方船名库精确匹配后的智能回退/);''',
    '''  assert.match(tracking, /中外运官方船名库精确匹配后的智能回退/);
  assert.match(tracking, /discoverUnknownCarrierByOfficialSchedule/);
  assert.match(tracking, /candidateIds = \\["cosco", "one", "hmm", "yang-ming", "maersk", "sinotrans"\\]/);
  assert.doesNotMatch(tracking, /carrier = sinotransVessel/);
  assert.match(tracking, /persistedQuerySource/);
  assert.match(tracking, /沿用上次成功的/);
  assert.match(tracking, /TrackingFailureCategory/);''',
    "test unknown-carrier discovery and fast-source reuse",
)

patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(carriers, /sharedCarrierFallbacks/);''',
    '''  assert.match(carriers, /sharedCarrierFallbacks/);
  assert.match(carriers, /normalizeSource/);
  assert.match(carriers, /Boolean\\(aliasKey && sourceKey\\.includes\\(aliasKey\\)\\)/);
  assert.match(carriers, /detectQuerySourceCarrier/);
  assert.ok(
    carriers.indexOf("if (container)") < carriers.indexOf("return carrierFromSource(input.source)")
  );
  assert.match(shipmentApi, /sailingIdentityChanged/);
  assert.match(shipmentApi, /atd = CASE WHEN \\? = 1 THEN '' ELSE atd END/);
  assert.match(shipmentApi, /ata = CASE WHEN \\? = 1 THEN '' ELSE ata END/);''',
    "test identity and timestamp safeguards",
)

print("Query-core patches applied successfully.")
