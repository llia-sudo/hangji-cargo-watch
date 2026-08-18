import { hasValidRequestSession } from "@/app/lib/password-auth";
import {
  createTrackingSession,
  syncShipment,
  TrackingResult,
  TrackingShipment,
} from "@/app/lib/tracking";
import { ensureShipmentsSchema, getD1 } from "@/db";
import { attachScheduleHistory } from "@/db/shipment-history";

export const dynamic = "force-dynamic";

const selectSql = `
  SELECT
    id,
    order_no AS orderNo,
    customer_code AS customerCode,
    vessel_name AS vesselName,
    voyage,
    bill_of_lading AS billOfLading,
    booking_no AS bookingNo,
    container_no AS containerNo,
    port_of_loading AS portOfLoading,
    port_of_discharge AS portOfDischarge,
    status,
    baseline_etd AS baselineEtd,
    etd,
    atd,
    baseline_eta AS baselineEta,
    eta,
    ata,
    delay_days AS delayDays,
    carrier_id AS carrierId,
    preferred_query_source AS preferredQuerySource,
    source,
    source_url AS sourceUrl,
    last_checked_at AS lastCheckedAt,
    notes,
    archived_at AS archivedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM shipments
  ORDER BY id DESC
`;

function unauthorized() {
  return Response.json(
    { error: "登录已过期，请重新输入访问密码" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

function routingKey(vesselName?: string, pol?: string, pod?: string) {
  return [vesselName, pol, pod]
    .map((value) => (value ?? "").trim().toUpperCase())
    .join("|");
}

function subtractDays(value: string, days: number) {
  if (!value || days <= 0) return value;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function syncInSmallBatches(shipments: TrackingShipment[]) {
  const results: TrackingResult[] = [];
  const session = createTrackingSession();
  for (let index = 0; index < shipments.length; index += 4) {
    const batch = shipments.slice(index, index + 4);
    results.push(
      ...(await Promise.all(
        batch.map((shipment) => syncShipment(shipment, session))
      ))
    );
  }
  return results;
}

export async function POST(request: Request) {
  if (!(await hasValidRequestSession(request))) return unauthorized();

  try {
    const payload = (await request.json().catch(() => ({}))) as {
      orderNo?: string;
    };
    const requestedOrderNo = payload.orderNo?.trim();
    await ensureShipmentsSchema();
    const d1 = getD1();
    const current = await d1.prepare(selectSql).all<TrackingShipment>();
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
        carrierId: shipment.carrierId || "",
        preferredQuerySource:
          shipment.preferredQuerySource || profile?.preferredQuerySource || "",
      };
    });
    const shipments = (requestedOrderNo
      ? allShipments.filter(
          (shipment) => shipment.orderNo === requestedOrderNo
        )
      : allShipments
    ).filter((shipment) => !shipment.archivedAt);
    if (requestedOrderNo && !shipments.length) {
      return Response.json(
        { error: `没有找到订单 ${requestedOrderNo}` },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    const results = await syncInSmallBatches(shipments);
    const succeeded = results.filter(
      (result): result is Extract<TrackingResult, { ok: true }> => result.ok
    );
    const identified = results.filter(
      (
        result
      ): result is Extract<TrackingResult, { ok: false; identified: true }> =>
        !result.ok && result.identified
    );
    const checked = results.filter(
      (
        result
      ): result is Extract<TrackingResult, { ok: false; identified: false }> & {
        check: NonNullable<
          Extract<TrackingResult, { ok: false; identified: false }>["check"]
        >;
      } => !result.ok && !result.identified && Boolean(result.check)
    );

    if (succeeded.length || identified.length || checked.length) {
      const currentByOrderNo = new Map(
        allShipments.map((shipment) => [shipment.orderNo, shipment])
      );
      await d1.batch(
        [
          ...succeeded.flatMap(({ orderNo, update }) => {
            const before = currentByOrderNo.get(orderNo);
            if (!before) return [];
            const baselineEtd =
              before.baselineEtd ||
              update.baselineEtd ||
              update.etd ||
              subtractDays(update.atd, update.delayDays);
            const baselineEta =
              before.baselineEta ||
              update.baselineEta ||
              (update.delayDays > 0
                ? subtractDays(update.eta || update.ata, update.delayDays)
                : update.eta || update.ata);
            const scheduleChanged =
              before.vesselName !== update.vesselName ||
              before.voyage !== update.voyage ||
              before.portOfLoading !== update.portOfLoading ||
              before.portOfDischarge !== update.portOfDischarge ||
              before.status !== update.status ||
              before.etd !== update.etd ||
              before.atd !== update.atd ||
              before.eta !== update.eta ||
              before.ata !== update.ata;
            const statements = [
              d1.prepare(`
                INSERT INTO shipment_schedule_history (
                  shipment_id, checked_at, vessel_name, voyage, status,
                  etd, atd, eta, ata, source
                )
                SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?
                FROM shipments
                WHERE order_no = ?
                  AND (etd <> '' OR atd <> '' OR eta <> '' OR ata <> '')
                  AND NOT EXISTS (
                    SELECT 1 FROM shipment_schedule_history
                    WHERE shipment_id = shipments.id
                  )
              `).bind(
                before.lastCheckedAt || update.lastCheckedAt,
                before.vesselName,
                before.voyage,
                before.status,
                before.etd,
                before.atd,
                before.eta,
                before.ata,
                before.source,
                orderNo
              ),
              d1
                .prepare(`
              UPDATE shipments SET
                vessel_name = ?,
                voyage = ?,
                port_of_loading = ?,
                port_of_discharge = ?,
                status = ?,
                baseline_etd = ?,
                etd = ?,
                atd = ?,
                baseline_eta = ?,
                eta = ?,
                ata = ?,
                delay_days = ?,
                carrier_id = ?,
                preferred_query_source = ?,
                source = ?,
                source_url = ?,
                last_checked_at = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE order_no = ?
            `)
              .bind(
                update.vesselName,
                update.voyage,
                update.portOfLoading,
                update.portOfDischarge,
                update.status,
                baselineEtd,
                update.etd,
                update.atd,
                baselineEta,
                update.eta,
                update.ata,
                update.delayDays,
                update.carrierId || before.carrierId || "",
                update.preferredQuerySource || update.carrierId || before.preferredQuerySource || before.carrierId || "",
                update.source,
                update.sourceUrl,
                update.lastCheckedAt,
                update.notes,
                orderNo
              ),
            ];
            const learnedCarrierId = update.carrierId || before.carrierId || "";
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
              statements.push(d1.prepare(`
                INSERT INTO shipment_schedule_history (
                  shipment_id, checked_at, vessel_name, voyage, status,
                  etd, atd, eta, ata, source
                )
                SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?
                FROM shipments
                WHERE order_no = ?
              `).bind(
                update.lastCheckedAt,
                update.vesselName,
                update.voyage,
                update.status,
                update.etd,
                update.atd,
                update.eta,
                update.ata,
                update.source,
                orderNo
              ));
            }
            return statements;
          }),
          ...identified.map(({ orderNo, identification }) =>
            d1
              .prepare(`
                UPDATE shipments SET
                  carrier_id = CASE WHEN ? <> '' THEN ? ELSE carrier_id END,
                  preferred_query_source = CASE WHEN ? <> '' THEN ? ELSE preferred_query_source END,
                  source = ?,
                  source_url = ?,
                  last_checked_at = ?,
                  notes = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE order_no = ?
              `)
              .bind(
                identification.carrierId || "",
                identification.carrierId || "",
                identification.preferredQuerySource || "",
                identification.preferredQuerySource || "",
                identification.source,
                identification.sourceUrl,
                identification.lastCheckedAt,
                identification.notes,
                orderNo
              )
          ),
          ...checked.map(({ orderNo, check }) =>
            d1
              .prepare(`
                UPDATE shipments SET
                  source = ?,
                  source_url = ?,
                  last_checked_at = ?,
                  notes = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE order_no = ?
              `)
              .bind(
                check.source,
                check.sourceUrl,
                check.lastCheckedAt,
                check.notes,
                orderNo
              )
          ),
        ]
      );
    }

    const refreshed = await d1.prepare(selectSql).all<{ id: number }>();
    const refreshedWithHistory = await attachScheduleHistory(
      refreshed.results ?? []
    );
    const failed = results.filter(
      (result) => !result.ok && !result.identified
    );
    return Response.json(
      {
        shipments: refreshedWithHistory,
        summary: {
          total: shipments.length,
          succeeded: succeeded.length,
          identified: identified.length,
          failed: failed.length,
        },
        results,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量查询失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
