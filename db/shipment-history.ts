import { getD1 } from "@/db";

export type ScheduleHistoryEntry = {
  id: number;
  shipmentId: number;
  checkedAt: string;
  vesselName: string;
  voyage: string;
  status: string;
  etd: string;
  atd: string;
  eta: string;
  ata: string;
  source: string;
};

type ShipmentWithBaseline = {
  id: number;
  baselineEtd?: string;
  baselineEta?: string;
  vesselName?: string;
  voyage?: string;
  createdAt?: string;
};

function sameSchedule(a: ScheduleHistoryEntry, b: ScheduleHistoryEntry) {
  return (
    a.vesselName === b.vesselName &&
    a.voyage === b.voyage &&
    a.status === b.status &&
    a.etd === b.etd &&
    a.atd === b.atd &&
    a.eta === b.eta &&
    a.ata === b.ata
  );
}

export async function attachScheduleHistory<T extends ShipmentWithBaseline>(
  shipments: T[]
): Promise<Array<T & { scheduleHistory: ScheduleHistoryEntry[] }>> {
  if (!shipments.length) return [];

  const placeholders = shipments.map(() => "?").join(", ");
  const ids = shipments.map((shipment) => shipment.id);
  const { results } = await getD1()
    .prepare(`
      SELECT
        id,
        shipment_id AS shipmentId,
        checked_at AS checkedAt,
        vessel_name AS vesselName,
        voyage,
        status,
        etd,
        atd,
        eta,
        ata,
        source
      FROM shipment_schedule_history
      WHERE shipment_id IN (${placeholders})
      ORDER BY checked_at DESC, id DESC
    `)
    .bind(...ids)
    .all<ScheduleHistoryEntry>();

  const shipmentById = new Map(
    shipments.map((shipment) => [shipment.id, shipment])
  );
  const byShipment = new Map<number, ScheduleHistoryEntry[]>();
  for (const entry of results ?? []) {
    const shipment = shipmentById.get(entry.shipmentId);
    const normalized = {
      ...entry,
      etd: entry.etd || (entry.atd ? shipment?.baselineEtd ?? "" : ""),
    };
    const list = byShipment.get(entry.shipmentId) ?? [];
    if (list.length && sameSchedule(list[list.length - 1], normalized)) continue;
    list.push(normalized);
    byShipment.set(entry.shipmentId, list);
  }

  return shipments.map((shipment) => {
    const scheduleHistory = byShipment.get(shipment.id) ?? [];
    const baselineEtd = shipment.baselineEtd ?? "";
    const baselineEta = shipment.baselineEta ?? "";
    const oldest = scheduleHistory[scheduleHistory.length - 1];
    const alreadyHasBaseline = Boolean(
      oldest &&
      !oldest.atd &&
      !oldest.ata &&
      oldest.etd === baselineEtd &&
      oldest.eta === baselineEta
    );

    if ((baselineEtd || baselineEta) && !alreadyHasBaseline) {
      scheduleHistory.push({
        id: -shipment.id,
        shipmentId: shipment.id,
        checkedAt: shipment.createdAt ?? "",
        vesselName: shipment.vesselName ?? "",
        voyage: shipment.voyage ?? "",
        status: "初始计划",
        etd: baselineEtd,
        atd: "",
        eta: baselineEta,
        ata: "",
        source: "初始船期",
      });
    }

    return { ...shipment, scheduleHistory };
  });
}
