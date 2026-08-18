from pathlib import Path


def patch(path: str, before: str, after: str, label: str) -> None:
    file = Path(path)
    content = file.read_text(encoding="utf-8")
    if after in content:
        return
    if before not in content:
        raise RuntimeError(f"Patch anchor not found in {path}: {label}")
    file.write_text(content.replace(before, after, 1), encoding="utf-8")


# Historical automatic query text must never become carrier identity. Only an
# exact manual carrier name/alias may be used as the last-resort source hint.
patch(
    "app/lib/carriers.ts",
    '''function carrierFromSource(source?: string) {
  const sourceKey = normalizeSource(source);
  if (!sourceKey) return undefined;
  const fallbackSource = sourceKey.includes("智能回退") || sourceKey.includes("共舱回退");
  if (fallbackSource) return undefined;
  return detectQuerySourceCarrier(source);
}''',
    '''function carrierFromSource(source?: string) {
  const sourceKey = normalizeSource(source);
  if (!sourceKey) return undefined;
  const fallbackSource = sourceKey.includes("智能回退") || sourceKey.includes("共舱回退");
  if (fallbackSource) return undefined;
  return carriers.find((carrier) => {
    const shortNameKey = normalizeSource(carrier.shortName);
    if (shortNameKey && sourceKey === shortNameKey) return true;
    return carrier.aliases.some((alias) => {
      const aliasKey = normalizeSource(alias);
      return Boolean(aliasKey && sourceKey === aliasKey);
    });
  });
}''',
    "restrict source identity hint to exact manual carrier values",
)

# Route profiles provide only a query-source hint. They do not assert carrier
# identity, because a physical vessel can change operator over time.
patch(
    "app/api/shipments/sync/route.ts",
    '''      return {
        ...shipment,
        carrierId: shipment.carrierId || profile?.carrierId || "",
        preferredQuerySource:
          shipment.preferredQuerySource || profile?.preferredQuerySource || "",
      };''',
    '''      return {
        ...shipment,
        carrierId: shipment.carrierId || "",
        preferredQuerySource:
          shipment.preferredQuerySource || profile?.preferredQuerySource || "",
      };''',
    "do not hydrate carrier identity from route profile",
)

# If carrier identity is still unknown, a learned preferred source gets one
# strict attempt before the wider official-discovery fan-out.
patch(
    "app/lib/tracking.ts",
    '''  try {
    if (!carrier) {
      const onlineIdentificationPromise = findCarrierOnline(''',
    '''  try {
    const learnedQuerySource = shipment.preferredQuerySource
      ? carriers.find((item) => item.id === shipment.preferredQuerySource)
      : undefined;
    if (
      !carrier &&
      learnedQuerySource &&
      supportsAutomaticCarrierQuery(learnedQuerySource)
    ) {
      try {
        const learnedUpdate = await cachedCarrierQuery(
          learnedQuerySource,
          shipment,
          session,
          {
            allowVoyageAlias: false,
            sourceCarrier: learnedQuerySource,
          }
        );
        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `沿用已验证船名航线记录，${learnedQuerySource.shortName} 查询成功`,
          update: {
            ...learnedUpdate,
            carrierId: learnedQuerySource.id,
            preferredQuerySource: learnedQuerySource.id,
            notes: `优先使用同船名同航线历史成功来源 ${learnedQuerySource.shortName}；本次仍严格匹配船名、航次及有序两港。${learnedUpdate.notes}`,
          },
        };
      } catch {
        // Learned source is stale or unavailable. Continue to fresh discovery.
      }
    }

    if (!carrier) {
      const onlineIdentificationPromise = findCarrierOnline(''',
    "try learned source safely before unknown-carrier fanout",
)

# Use failure classification to decide whether a fallback should be remembered.
patch(
    "app/lib/tracking.ts",
    '''    let primaryError = "";
    if (supportsAutomaticCarrierQuery(carrier)) {''',
    '''    let primaryError = "";
    let primaryFailureCategory: TrackingFailureCategory | "" = "";
    if (supportsAutomaticCarrierQuery(carrier)) {''',
    "track primary failure category",
)

patch(
    "app/lib/tracking.ts",
    '''      } catch (error) {
        primaryError = trackingErrorReason(error);
      }
    }

    const sinotransCandidate = await sinotransCandidatePromise;''',
    '''      } catch (error) {
        const failure = trackingErrorDetail(error);
        primaryError = failure.reason;
        primaryFailureCategory = failure.category;
      }
    }

    const sinotransCandidate = await sinotransCandidatePromise;''',
    "classify primary failure without another request",
)

patch(
    "app/lib/tracking.ts",
    '''        const update: TrackingUpdate = {
          ...winner.update,
          carrierId: carrier.id,
          preferredQuerySource: winner.sourceCarrier.id,
          // The order keeps the customer's voyage number.''',
    '''        const shouldRememberFallback =
          !supportsAutomaticCarrierQuery(carrier) ||
          ["VESSEL_NOT_FOUND", "VOYAGE_NOT_FOUND", "PORT_MISMATCH"].includes(
            primaryFailureCategory
          );
        const update: TrackingUpdate = {
          ...winner.update,
          carrierId: carrier.id,
          preferredQuerySource: shouldRememberFallback
            ? winner.sourceCarrier.id
            : carrier.id,
          // The order keeps the customer's voyage number.''',
    "remember fallback only after substantive primary mismatch",
)

patch(
    "app/lib/tracking.ts",
    '''          notes: `${fallbackKind}：${carrier.shortName} → ${winner.sourceCarrier.shortName}（${relationship}）${partnerVoyageNote(shipment.voyage, partnerVoyage)}。${winner.update.notes}`,''',
    '''          notes: `${fallbackKind}：${carrier.shortName} → ${winner.sourceCarrier.shortName}（${relationship}）${partnerVoyageNote(shipment.voyage, partnerVoyage)}。${shouldRememberFallback ? `主来源结果类型 ${primaryFailureCategory || "UNAVAILABLE"}，下次优先沿用该成功来源。` : `主来源结果类型 ${primaryFailureCategory || "UNKNOWN"} 属临时异常，本次使用回退但下次仍优先 ${carrier.shortName}。`}${winner.update.notes}`,''',
    "record why fallback was or was not remembered",
)

# Regression checks for the two edge cases above.
patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(carriers, /detectQuerySourceCarrier/);''',
    '''  assert.match(carriers, /detectQuerySourceCarrier/);
  assert.match(carriers, /sourceKey === shortNameKey/);
  assert.match(carriers, /sourceKey === aliasKey/);''',
    "test exact-only source identity hint",
)

patch(
    "tests/cargo-watch.test.mjs",
    '''  assert.match(tracking, /TrackingFailureCategory/);''',
    '''  assert.match(tracking, /TrackingFailureCategory/);
  assert.match(tracking, /primaryFailureCategory/);
  assert.match(tracking, /shouldRememberFallback/);
  assert.match(tracking, /沿用已验证船名航线记录/);
  assert.doesNotMatch(syncApi, /shipment\.carrierId \|\| profile\?\.carrierId/);''',
    "test transient-failure and profile identity safeguards",
)

print("Final query safety patches applied successfully.")
