import { ensureShipmentsSchema, getD1 } from "@/db";

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
    etd,
    atd,
    eta,
    ata,
    delay_days AS delayDays,
    source,
    source_url AS sourceUrl,
    last_checked_at AS lastCheckedAt,
    notes,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM shipments
  ORDER BY
    CASE status
      WHEN '可能延期' THEN 0
      WHEN '运输中' THEN 1
      WHEN '待开船' THEN 2
      WHEN '已到港' THEN 3
      ELSE 4
    END,
    updated_at DESC,
    id DESC
`;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
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

  return d1
    .prepare(`
      INSERT INTO shipments (
        order_no, customer_code, vessel_name, voyage, bill_of_lading,
        booking_no, container_no, port_of_loading, port_of_discharge,
        status, etd, atd, eta, ata, delay_days, source, source_url,
        last_checked_at, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
        etd = excluded.etd,
        atd = excluded.atd,
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
      row.etd,
      row.atd,
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
      atd: "2026-07-06",
      eta: "2026-08-12",
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

export async function GET() {
  try {
    await ensureShipmentsSchema();
    await seedIfEmpty();
    const { results } = await getD1().prepare(selectSql).all();
    return Response.json({ shipments: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取订单失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    const { results } = await getD1().prepare(selectSql).all();
    return Response.json({ shipments: results, imported: inputs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存订单失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
