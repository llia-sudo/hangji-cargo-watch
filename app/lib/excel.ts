export type ImportedShipment = {
  orderNo: string;
  customerCode: string;
  vesselName: string;
  voyage: string;
  billOfLading: string;
  bookingNo: string;
  containerNo: string;
  portOfLoading: string;
  portOfDischarge: string;
  etd: string;
  eta: string;
  status: string;
  source: string;
};

const headerAliases: Record<keyof ImportedShipment, string[]> = {
  orderNo: ["订单号", "ORDER NO", "ORDER NUMBER", "ORDERNO"],
  customerCode: ["客户编号", "CUSTOMER CODE", "CUSTOMER NO", "CUSTOMER"],
  vesselName: ["船名", "VESSEL", "VESSEL NAME"],
  voyage: ["航次", "VOYAGE", "VOY", "VOYAGE NO"],
  billOfLading: ["提单号", "B/L", "BL", "BILL OF LADING"],
  bookingNo: ["BOOKING NO", "BOOKING", "BOOKING NUMBER"],
  containerNo: ["箱号", "集装箱号", "CONTAINER NO", "CONTAINER NUMBER"],
  portOfLoading: ["起运港", "启运港", "POL", "PORT OF LOADING"],
  portOfDischarge: ["目的港", "POD", "PORT OF DISCHARGE", "DESTINATION"],
  etd: ["ETD", "预计开船", "计划开船"],
  eta: ["ETA", "预计到港", "计划到港"],
  status: ["状态", "STATUS"],
  source: ["船公司", "数据来源", "CARRIER", "SHIPPING LINE", "SOURCE"],
};

function normalizeHeader(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function fieldForHeader(header: string) {
  const normalized = normalizeHeader(header);
  return (Object.keys(headerAliases) as (keyof ImportedShipment)[]).find((key) =>
    headerAliases[key].some((alias) => normalizeHeader(alias) === normalized)
  );
}

function blankShipment(): ImportedShipment {
  return {
    orderNo: "",
    customerCode: "",
    vesselName: "",
    voyage: "",
    billOfLading: "",
    bookingNo: "",
    containerNo: "",
    portOfLoading: "",
    portOfDischarge: "",
    etd: "",
    eta: "",
    status: "待查询",
    source: "Excel 导入",
  };
}

function rowsToShipments(rows: string[][]) {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => fieldForHeader(cell) === "orderNo")
  );
  if (headerIndex < 0) {
    throw new Error("找不到“订单号”列，请使用导入模板。");
  }

  const fields = rows[headerIndex].map(fieldForHeader);
  const shipments = rows
    .slice(headerIndex + 1)
    .map((row) => {
      const shipment = blankShipment();
      fields.forEach((field, index) => {
        if (!field) return;
        const value = String(row[index] ?? "").trim();
        if (value) shipment[field] = value;
      });
      shipment.orderNo = shipment.orderNo.toUpperCase();
      shipment.vesselName = shipment.vesselName.toUpperCase();
      shipment.voyage = shipment.voyage.toUpperCase();
      shipment.billOfLading = shipment.billOfLading.toUpperCase();
      shipment.bookingNo = shipment.bookingNo.toUpperCase();
      shipment.containerNo = shipment.containerNo.toUpperCase();
      shipment.portOfLoading = shipment.portOfLoading.toUpperCase();
      shipment.portOfDischarge = shipment.portOfDischarge.toUpperCase();
      return shipment;
    })
    .filter((shipment) => shipment.orderNo);

  if (!shipments.length) {
    throw new Error("表格中没有可导入的订单。");
  }
  if (shipments.length > 200) {
    throw new Error("每次最多导入 200 条订单。");
  }

  return shipments;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

async function inflateRaw(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let endOffset = -1;

  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("无法读取这个 Excel 文件。");

  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder("utf-8");
  const files = new Map<string, Uint8Array>();

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) break;
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));

    if (view.getUint32(localOffset, true) === 0x04034b50) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      if (method === 0) files.set(name, compressed);
      if (method === 8) files.set(name, await inflateRaw(compressed));
    }

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function xmlText(bytes?: Uint8Array) {
  if (!bytes) return "";
  return new TextDecoder("utf-8").decode(bytes);
}

function elementsByLocalName(parent: Document | Element, localName: string) {
  return Array.from(parent.getElementsByTagName("*")).filter(
    (element) => element.localName === localName
  );
}

function columnIndex(cellRef: string) {
  const letters = cellRef.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return letters.split("").reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function parseXlsx(buffer: ArrayBuffer) {
  const files = await unzip(buffer);
  const parser = new DOMParser();
  const shared: string[] = [];
  const sharedXml = xmlText(files.get("xl/sharedStrings.xml"));
  if (sharedXml) {
    const doc = parser.parseFromString(sharedXml, "application/xml");
    elementsByLocalName(doc, "si").forEach((item) => {
      shared.push(elementsByLocalName(item, "t").map((node) => node.textContent ?? "").join(""));
    });
  }

  let worksheetPath = "xl/worksheets/sheet1.xml";
  const workbookXml = xmlText(files.get("xl/workbook.xml"));
  const relsXml = xmlText(files.get("xl/_rels/workbook.xml.rels"));
  if (workbookXml && relsXml) {
    const workbook = parser.parseFromString(workbookXml, "application/xml");
    const firstSheet = elementsByLocalName(workbook, "sheet")[0];
    const relationshipId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rels = parser.parseFromString(relsXml, "application/xml");
    const relationship = elementsByLocalName(rels, "Relationship").find(
      (item) => item.getAttribute("Id") === relationshipId
    );
    const target = relationship?.getAttribute("Target");
    if (target) worksheetPath = `xl/${target.replace(/^\//, "").replace(/^xl\//, "")}`;
  }

  const sheetXml = xmlText(files.get(worksheetPath));
  if (!sheetXml) throw new Error("找不到 Excel 的第一个工作表。");
  const sheet = parser.parseFromString(sheetXml, "application/xml");

  return elementsByLocalName(sheet, "row").map((row) => {
    const values: string[] = [];
    elementsByLocalName(row, "c").forEach((cell) => {
      const index = columnIndex(cell.getAttribute("r") ?? "A1");
      const type = cell.getAttribute("t");
      const raw = elementsByLocalName(cell, "v")[0]?.textContent ?? "";
      let value = raw;
      if (type === "s") value = shared[Number(raw)] ?? "";
      if (type === "inlineStr") {
        value = elementsByLocalName(cell, "t").map((node) => node.textContent ?? "").join("");
      }
      values[index] = value;
    });
    return values;
  });
}

export async function parseShipmentFile(file: File) {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("文件不能超过 5MB。");
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return rowsToShipments(parseCsv((await file.text()).replace(/^\uFEFF/, "")));
  }
  if (extension === "xlsx") {
    return rowsToShipments(await parseXlsx(await file.arrayBuffer()));
  }

  throw new Error("请上传 .xlsx 或 .csv 文件。");
}

export function downloadTemplate() {
  const rows = [
    ["订单号", "客户编号", "船公司", "船名", "航次", "提单号", "Booking No.", "箱号", "起运港", "目的港", "ETD", "ETA"],
    ["226GRD0390", "", "Evergreen", "TAMPA TRIUMPH", "0789-043E", "SGH260014656", "", "EMCU1760509", "SHANGHAI", "", "", ""],
    ["226GRD0664", "", "PANCON", "PANCON GLORY", "2623E", "AMIGL260343012A", "", "", "SHANGHAI", "INCHON", "", ""],
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "订单导入模板.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
