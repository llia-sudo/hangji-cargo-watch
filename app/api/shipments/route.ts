import { ensureShipmentsSchema, getD1 } from "@/db";
import { attachScheduleHistory } from "@/db/shipment-history";
import { hasValidRequestSession } from "@/app/lib/password-auth";

export const dynamic = "force-dynamic";

type ShipmentInput = {
  orderNo?: string;
  customerCode?: string;
  vesselName?: string;
  voyage?: string;
  billOfLading?: string;
  bookingNo?: string;
  containerNo?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  status?: string;
  etd?: string;
  atd?: string;
  eta?: string;
  ata?: string;
  delayDays?: number;
  source?: string;
  sourceUrl?: string;
  lastCheckedAt?: string;
  notes?: string;
};

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

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function subtractDays(value: string, days: number) {
  if (!value || days <= 0) return value;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizeShipment(input: ShipmentInput) {
  return {
    orderNo: clean(input.orderNo).toUpperCase(),
    customerCode: clean(input.customerCode),
    vesselName: clean(input.vesselName).toUpperCase(),
    voyage: clean(input.voyage).toUpperCase(),
    billOfLading: clean(input.billOfLading).toUpperCase(),
    bookingNo: clean(input.bookingNo).toUpperCase(),
    containerNo: clean(input.containerNo).toUpperCase(),
    portOfLoading: clean(input.portOfLoading).toUpperCase(),
    portOfDischarge: clean(input.portOfDischarge).toUpperCase(),
    status: clean(input.status) || "待查询",
    etd: clean(input.etd),
    atd: clean(input.atd),
    eta: clean(input.eta),
    ata: clean(input.ata),
    delayDays: Number.isFinite(Number(input.delayDays))
      ? Math.max(0, Math.min(365, Number(input.delayDays)))
      : 0,
    source: clean(input.source) || "手工录入",
    sourceUrl: clean(input.sourceUrl),
    lastCheckedAt: clean(input.lastCheckedAt),
    notes: clean(input.notes).slice(0, 500),
  };
}

function upsertStatement(input: ShipmentInput) {
  const d1 = getD1();
  const row = normalizeShipment(input);
  const baselineEtd = row.etd || subtractDays(row.atd, row.delayDays);
  const baselineEta = row.delayDays > 0
    ? subtractDays(row.eta || row.ata, row.delayDays)
    : row.eta || row.ata;

  return d1
    .prepare(`
      INSERT INTO shipments (
        order_no, customer_code, vessel_name, voyage, bill_of_lading,
        booking_no, container_no, port_of_loading, port_of_discharge,
        status, baseline_etd, etd, atd, baseline_eta, eta, ata, delay_days, source, source_url,
        last_checked_at, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(order_no) DO UPDATE SET
        customer_code = excluded.customer_code,
        vessel_name = excluded.vessel_name,
        voyage = excluded.voyage,
        bill_of_lading = excluded.bill_of_lading,
        booking_no = excluded.booking_no,
        container_no = excluded.container_no,
        port_of_loading = excluded.port_of_loading,
        port_of_discharge = excluded.port_of_discharge,
        status = excluded.status,
        baseline_etd = CASE
          WHEN shipments.baseline_etd = '' AND excluded.baseline_etd <> '' THEN excluded.baseline_etd
          ELSE shipments.baseline_etd
        END,
        etd = excluded.etd,
        atd = excluded.atd,
        baseline_eta = CASE
          WHEN shipments.baseline_eta = '' AND excluded.baseline_eta <> '' THEN excluded.baseline_eta
          ELSE shipments.baseline_eta
        END,
        eta = excluded.eta,
        ata = excluded.ata,
        delay_days = excluded.delay_days,
        source = excluded.source,
        source_url = excluded.source_url,
        last_checked_at = excluded.last_checked_at,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(
      row.orderNo,
      row.customerCode,
      row.vesselName,
      row.voyage,
      row.billOfLading,
      row.bookingNo,
      row.containerNo,
      row.portOfLoading,
      row.portOfDischarge,
      row.status,
      baselineEtd,
      row.etd,
      row.atd,
      baselineEta,
      row.eta,
      row.ata,
      row.delayDays,
      row.source,
      row.sourceUrl,
      row.lastCheckedAt,
      row.notes
    );
}

async function seedIfEmpty() {
  const d1 = getD1();
  const count = await d1
    .prepare("SELECT COUNT(*) AS count FROM shipments")
    .first<{ count: number }>();

  if (Number(count?.count ?? 0) > 0) return;

  await d1.batch([
    upsertStatement({
      orderNo: "226GRD0390",
      vesselName: "TAMPA TRIUMPH",
      voyage: "0789-043E",
      billOfLading: "SGH260014656",
      containerNo: "EMCU1760509",
      portOfLoading: "SHANGHAI",
      status: "运输中",
      etd: "2026-07-03",
      atd: "2026-07-06",
      eta: "2026-08-15",
      delayDays: 3,
      source: "Evergreen ShipmentLink",
      sourceUrl:
        "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do",
      lastCheckedAt: "2026-08-04 21:10",
      notes: "已在上海装船；不同共舱船公司的中转港 ETA 存在差异。",
    }),
    upsertStatement({
      orderNo: "226GRD0664",
      vesselName: "PANCON GLORY",
      voyage: "2623E",
      billOfLading: "AMIGL260343012A",
      portOfLoading: "SHANGHAI",
      portOfDischarge: "INCHON",
      status: "已到港",
      etd: "2026-07-12",
      eta: "2026-07-14",
      ata: "2026-07-18",
      delayDays: 4,
      source: "仁川港 / PANCON",
      sourceUrl: "https://www.pancon.co.kr/pcl/bl",
      lastCheckedAt: "2026-08-04 21:10",
      notes: "船舶已到过仁川并开始后续航次；缺少箱号，尚未单独验证卸箱节点。",
    }),
  ]);
}

function unauthorized() {
  return Response.json(
    { error: "登录已过期，请重新输入访问密码" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  if (!await hasValidRequestSession(request)) return unauthorized();
  try {
    await ensureShipmentsSchema();
    await seedIfEmpty();
    const { results } = await getD1().prepare(selectSql).all<{ id: number }>();
    const shipments = await attachScheduleHistory(results ?? []);
    return Response.json({ shipments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取订单失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await hasValidRequestSession(request)) return unauthorized();
  try {
    await ensureShipmentsSchema();
    const body = (await request.json()) as {
      shipment?: ShipmentInput;
      shipments?: ShipmentInput[];
    };
    const inputs = body.shipments ?? (body.shipment ? [body.shipment] : []);

    if (!inputs.length) {
      return Response.json({ error: "没有可导入的订单" }, { status: 400 });
    }
    if (inputs.length > 200) {
      return Response.json(
        { error: "每次最多导入 200 条订单" },
        { status: 400 }
      );
    }

    const normalized = inputs.map(normalizeShipment);
    const invalid = normalized.find((row) => !row.orderNo);
    if (invalid) {
      return Response.json(
        { error: "每条记录都必须有订单号" },
        { status: 400 }
      );
    }

    await getD1().batch(inputs.map(upsertStatement));
    const { results } = await getD1().prepare(selectSql).all<{ id: number }>();
    const shipments = await attachScheduleHistory(results ?? []);
    return Response.json({ shipments, imported: inputs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存订单失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!await hasValidRequestSession(request)) return unauthorized();
  try {
    await ensureShipmentsSchema();
    const body = (await request.json()) as {
      action?: "edit" | "archive";
      id?: number;
      shipment?: ShipmentInput;
      orderNo?: string;
      archived?: boolean;
    };

    if (body.action === "edit") {
      const id = Number(body.id);
      const row = normalizeShipment(body.shipment ?? {});
      if (!Number.isInteger(id) || id <= 0 || !row.orderNo) {
        return Response.json(
          { error: "缺少有效的订单记录或订单号" },
          { status: 400 }
        );
      }

      const existing = await getD1()
        .prepare(`
          SELECT
            id,
            order_no AS orderNo,
            vessel_name AS vesselName,
            voyage,
            bill_of_lading AS billOfLading,
            booking_no AS bookingNo,
            container_no AS containerNo,
            port_of_loading AS portOfLoading,
            port_of_discharge AS portOfDischarge,
            source
          FROM shipments
          WHERE id = ?
        `)
        .bind(id)
        .first<{
          id: number;
          orderNo: string;
          vesselName: string;
          voyage: string;
          billOfLading: string;
          bookingNo: string;
          containerNo: string;
          portOfLoading: string;
          portOfDischarge: string;
          source: string;
        }>();

      if (!existing) {
        return Response.json({ error: "没有找到需要编辑的订单" }, { status: 404 });
      }

      const duplicate = await getD1()
        .prepare("SELECT id FROM shipments WHERE order_no = ? AND id <> ?")
        .bind(row.orderNo, id)
        .first<{ id: number }>();
      if (duplicate) {
        return Response.json(
          { error: `订单号 ${row.orderNo} 已被其他订单使用` },
          { status: 409 }
        );
      }

      const trackingKeysChanged = [
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
      });

      const result = await getD1()
        .prepare(`
          UPDATE shipments
          SET
            order_no = ?,
            customer_code = ?,
            vessel_name = ?,
            voyage = ?,
            bill_of_lading = ?,
            booking_no = ?,
            container_no = ?,
            port_of_loading = ?,
            port_of_discharge = ?,
            status = ?,
            baseline_etd = CASE
              WHEN baseline_etd = '' AND ? <> '' THEN ?
              ELSE baseline_etd
            END,
            etd = ?,
            atd = CASE WHEN ? = 1 THEN '' ELSE atd END,
            baseline_eta = CASE
              WHEN baseline_eta = '' AND ? <> '' THEN ?
              ELSE baseline_eta
            END,
            eta = ?,
            ata = CASE WHEN ? = 1 THEN '' ELSE ata END,
            source = ?,
            source_url = CASE WHEN ? = 1 THEN '' ELSE source_url END,
            last_checked_at = CASE WHEN ? = 1 THEN '' ELSE last_checked_at END,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          row.orderNo,
          row.customerCode,
          row.vesselName,
          row.voyage,
          row.billOfLading,
          row.bookingNo,
          row.containerNo,
          row.portOfLoading,
          row.portOfDischarge,
          row.status,
          row.etd,
          row.etd,
          row.etd,
          sailingIdentityChanged ? 1 : 0,
          row.eta,
          row.eta,
          row.eta,
          sailingIdentityChanged ? 1 : 0,
          row.source,
          trackingKeysChanged ? 1 : 0,
          trackingKeysChanged ? 1 : 0,
          row.notes,
          id
        )
        .run();

      if (!result.meta.changes) {
        return Response.json({ error: "订单信息没有保存" }, { status: 500 });
      }

      const { results } = await getD1().prepare(selectSql).all<{ id: number }>();
      const shipments = await attachScheduleHistory(results ?? []);
      return Response.json({
        shipments,
        edited: true,
        id,
        orderNo: row.orderNo,
        trackingKeysChanged,
      });
    }

    const orderNo = clean(body.orderNo).toUpperCase();
    if (!orderNo || typeof body.archived !== "boolean") {
      return Response.json(
        { error: "缺少订单号或归档状态" },
        { status: 400 }
      );
    }

    const result = await getD1()
      .prepare(`
        UPDATE shipments
        SET archived_at = CASE
          WHEN ? = 1 THEN strftime('%Y-%m-%d %H:%M', 'now', '+8 hours')
          ELSE ''
        END,
        updated_at = CURRENT_TIMESTAMP
        WHERE order_no = ?
      `)
      .bind(body.archived ? 1 : 0, orderNo)
      .run();
    if (!result.meta.changes) {
      return Response.json(
        { error: `没有找到订单 ${orderNo}` },
        { status: 404 }
      );
    }

    const { results } = await getD1().prepare(selectSql).all<{ id: number }>();
    const shipments = await attachScheduleHistory(results ?? []);
    return Response.json({ shipments, archived: body.archived, orderNo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "归档订单失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
