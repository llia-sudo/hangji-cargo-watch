import {
  Carrier,
  carriers,
  carrierTrackingUrl,
  detectCarrier,
  detectQuerySourceCarrier,
  sharedCarrierFallbackSources,
} from "@/app/lib/carriers";
import {
  identifyCarrierOnline,
  OnlineCarrierIdentification,
} from "@/app/lib/online-carrier-identification";

export type TrackingShipment = {
  id: number;
  orderNo: string;
  vesselName: string;
  voyage: string;
  billOfLading: string;
  bookingNo: string;
  containerNo: string;
  portOfLoading: string;
  portOfDischarge: string;
  status: string;
  baselineEtd?: string;
  etd: string;
  atd: string;
  baselineEta?: string;
  eta: string;
  ata: string;
  delayDays: number;
  source: string;
  sourceUrl: string;
  lastCheckedAt: string;
  notes: string;
  archivedAt?: string;
};

export type TrackingUpdate = Pick<
  TrackingShipment,
  | "vesselName"
  | "voyage"
  | "portOfLoading"
  | "portOfDischarge"
  | "status"
  | "baselineEtd"
  | "etd"
  | "atd"
  | "baselineEta"
  | "eta"
  | "ata"
  | "delayDays"
  | "source"
  | "sourceUrl"
  | "lastCheckedAt"
  | "notes"
>;

export type TrackingResult =
  | { ok: true; orderNo: string; message: string; update: TrackingUpdate }
  | {
      ok: false;
      identified: true;
      orderNo: string;
      message: string;
      identification: Pick<
        TrackingUpdate,
        "source" | "sourceUrl" | "lastCheckedAt" | "notes"
      >;
    }
  | {
      ok: false;
      identified: false;
      orderNo: string;
      message: string;
      check?: Pick<
        TrackingUpdate,
        "source" | "sourceUrl" | "lastCheckedAt" | "notes"
      >;
    };

type CarrierQueryContext = {
  allowVoyageAlias: boolean;
  primaryCarrier?: Carrier;
  sourceCarrier: Carrier;
};

const EVERGREEN_URL =
  "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do";
const PANCON_SCHEDULE_URL =
  "https://www.pancon.co.kr/pan/pageLink.pcl?link=COM%2FWEB_211";
const PANCON_BASE_URL = "https://www.pancon.co.kr/pan";
const COSCO_GLOBAL_SEARCH_URL =
  "https://elines.coscoshipping.com/ebusiness/sailingSchedule/searchByVesselName";
const COSCO_GLOBAL_RESULT_URL =
  "https://elines.coscoshipping.com/ebusiness/sailingSchedule/searchByVesselName/resultByVoyage";
const COSCO_VESSEL_LOOKUP_URL =
  "https://elines.coscoshipping.com/ebbase/public/general/findVesselByPrefix";
const COSCO_VESSEL_SCHEDULE_URL =
  "https://elines.coscoshipping.com/ebschedule/public/purpoShipment/vesselCode";
const COSCO_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const ONE_SCHEDULE_URL =
  "https://ecomm.one-line.com/one-ecom/schedule/vessel-schedule";
const ONE_API_BASE = "https://ecomm.one-line.com/api";
const HMM_SCHEDULE_URL =
  "https://www.hmm21.com/e-service/general/schedule/ScheduleMain.do";
const HMM_BASE_URL = "https://www.hmm21.com/e-service/general/schedule";
const YANG_MING_SCHEDULE_URL =
  "https://www.yangming.com/en/esolution/schedule/vessel_schedule";
const YANG_MING_API_BASE = "https://www.yangming.com/api/VesselTracking";
const MAERSK_SCHEDULE_URL =
  "https://www.maersk.com/schedules/vesselSchedules";
const MAERSK_API_BASE = "https://api.maersk.com";
// Public browser consumer key published by Maersk's vessel-schedule page.
const MAERSK_CONSUMER_KEY = "uXe7bxTHLY0yY0e8jnS6kotShkLuAAqG";
const SINOTRANS_SCHEDULE_URL =
  "https://ebusiness.sinolines.com.cn/Ebusiness/EQUERY/QuerySchedule.aspx";
const SINOTRANS_VESSEL_LIST_URL =
  "https://ebusiness.sinolines.com.cn/Ebusiness/EPlugin-AutoComplete-Vessel/content/countries.txt";
const SINOTRANS_VESSEL_CACHE_MS = 12 * 60 * 60 * 1_000;

const monthNumbers: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

function identifier(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function chinaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}`;
}

function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 18_000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEvergreenDate(value?: string) {
  if (!value) return "";
  const match = value.toUpperCase().match(/^([A-Z]{3})-(\d{2})-(\d{4})$/);
  if (!match || !monthNumbers[match[1]]) return "";
  return `${match[3]}-${monthNumbers[match[1]]}-${match[2]}`;
}

function parsePanconTimestamp(value?: string) {
  if (!value || !/^\d{8,12}$/.test(value)) return "";
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return value.length >= 12
    ? `${date} ${value.slice(8, 10)}:${value.slice(10, 12)}`
    : date;
}

function dayDifference(later?: string, earlier?: string) {
  if (!later || !earlier) return 0;
  const laterTime = Date.parse(`${later.slice(0, 10)}T00:00:00Z`);
  const earlierTime = Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(laterTime) || !Number.isFinite(earlierTime)) return 0;
  return Math.max(0, Math.ceil((laterTime - earlierTime) / 86_400_000));
}

function dateForPanconQuery(value?: string, daysBefore = 0) {
  const parsed = value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  date.setUTCDate(date.getUTCDate() - daysBefore);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function firstDayOfPanconMonth(value: string) {
  return `${value.slice(0, 6)}01`;
}

function timeLabel(value: string) {
  return value ? value.replace(" ", " ") : "未公布";
}

async function queryEvergreen(
  shipment: TrackingShipment
): Promise<TrackingUpdate> {
  const containerNo = identifier(shipment.containerNo);
  if (!/^[A-Z]{4}\d{7}$/.test(containerNo)) {
    throw new Error("缺少可用的 11 位集装箱号");
  }

  const firstResponse = await fetchWithTimeout(EVERGREEN_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 CargoWatch/1.0",
    },
  });
  const cookie = firstResponse.headers
    .get("set-cookie")
    ?.split(",")
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  await firstResponse.text();

  const body = new URLSearchParams({
    BL: "",
    CNTR: containerNo,
    bkno: "",
    TYPE: "CNTR",
    SEL: "s_cntr",
    NO: containerNo,
  });
  const response = await fetchWithTimeout(EVERGREEN_URL, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: EVERGREEN_URL,
      "User-Agent": "Mozilla/5.0 CargoWatch/1.0",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`官网返回 ${response.status}`);

  const text = htmlToText(await response.text());
  const containerIndex = text.toUpperCase().indexOf(containerNo);
  if (containerIndex < 0) throw new Error("官网没有返回该箱号的记录");

  const etaMatch = text.match(
    /Estimated Date of Arrival\s*:\s*([A-Z]{3}-\d{2}-\d{4})/i
  );
  const eta = parseEvergreenDate(etaMatch?.[1]) || shipment.eta;
  const movementText = text.slice(containerIndex, containerIndex + 1_200);
  const movementDateMatch = movementText.match(/([A-Z]{3}-\d{2}-\d{4})/i);
  const movementDate = parseEvergreenDate(movementDateMatch?.[1]);
  const movementStart = movementDateMatch?.index ?? 0;
  const movementTail = movementText.slice(movementStart, movementStart + 500);

  let movement = "官网已返回最新节点";
  if (/Loaded\s*(?:\([^)]*\))?\s*on vessel/i.test(movementTail)) {
    movement = "已装船";
  } else if (/Discharg/i.test(movementTail)) {
    movement = "已卸船";
  } else if (/Gate Out|Delivered|Empty Return/i.test(movementTail)) {
    movement = "已提箱或还空箱";
  } else if (/Gate In/i.test(movementTail)) {
    movement = "已进港";
  }

  const arrived = /Discharg|Gate Out|Delivered|Empty Return/i.test(movementTail);
  const loaded = /Loaded\s*(?:\([^)]*\))?\s*on vessel/i.test(movementTail);
  const nowDate = chinaTimestamp().slice(0, 10);
  const overdue = Boolean(eta && eta < nowDate && !arrived);
  const status = arrived
    ? "已到港"
    : overdue
      ? "可能延期"
      : loaded || shipment.atd
        ? "运输中"
        : "待开船";
  const atd = loaded && movementDate ? movementDate : shipment.atd;
  const ata = arrived && movementDate ? movementDate : shipment.ata;
  const delayDays = overdue
    ? Math.max(shipment.delayDays, dayDifference(nowDate, eta))
    : Math.max(shipment.delayDays, dayDifference(eta, shipment.eta));

  return {
    vesselName: shipment.vesselName,
    voyage: shipment.voyage,
    portOfLoading: shipment.portOfLoading,
    portOfDischarge: shipment.portOfDischarge,
    status,
    etd: shipment.etd,
    atd,
    eta,
    ata,
    delayDays,
    source: "Evergreen ShipmentLink 官网",
    sourceUrl: EVERGREEN_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `官网最新节点：${movement}${movementDate ? `（${movementDate}）` : ""}；预计到港 ${eta || "未公布"}。`,
  };
}

type PanconPort = {
  PLC_CD?: string;
  PLC_ENM?: string;
  COUNTRY_CD?: string;
};

type PanconSchedule = {
  VSL_NM?: string;
  VOY_NO?: string;
  POL?: string;
  POD?: string;
  POL_ETD?: string;
  POD_ETA?: string;
  ATD?: string;
  ATA?: string;
};

type CoscoVesselMatch = {
  code?: string;
  description?: string;
};

type CoscoGlobalSchedule = {
  id?: number;
  loopAbbrv?: string;
  vesselCode?: string;
  vesselName?: string;
  voy?: string;
  protName?: string;
  arrDtlocAct?: string | null;
  depDtlocAct?: string | null;
  arrDtlocCos?: string | null;
  depDtlocCos?: string | null;
};

type OneVessel = { code?: string; name?: string };
type OneVoyage = {
  scheduleVoyageNumber?: string;
  currentVoyageNo?: string;
};
type OneScheduleLine = {
  portName?: string;
  portCode?: string;
  consortiumVoyageNumber?: string;
  scheduleVoyageNumber?: string;
  vesselServiceLaneCode?: string;
  arrivalDateTime?: string;
  arrivalStatus?: string;
  departureDateTime?: string;
  departureStatus?: string;
};

type HmmSessionData = { cookie: string; csrf: string };
type HmmVessel = { optCd?: string; optNm?: string };
type HmmScheduleRow = {
  vslCd?: string;
  ltdvds?: string;
  ltdvvd?: string;
  voyInfo?: string;
  ptnVoyInfo?: string;
  portCd?: string;
  portNm?: string;
  arrDt?: string;
  arrStNm?: string;
  depDt?: string;
  depStNm?: string;
  vslSvcLoopCd?: string;
};

type YangMingVessel = { vesselCode?: string; vesselName?: string };
type YangMingPort = {
  portName?: string;
  portCode?: string;
  arrivalDate?: string;
  arrivalStatus?: string;
  departureDate?: string;
  departureStatus?: string;
  lastPosition?: boolean;
};
type YangMingStatus = {
  vesselName?: string;
  vesselCode?: string;
  latestVesselPosition?: {
    currentLane?: string;
    currentComnVoyage?: string;
    currentYMLVslVoy?: string;
    nowUsingVslVoy?: string;
    berthDetail?: YangMingPort[];
  };
  detailedVesselPosition?: {
    currentLane?: string;
    currentComnVoyage?: string;
    currentYMLVslVoy?: string;
    berthDetail?: YangMingPort[];
    nowUsingVslVoy?: string;
  };
};

type MaerskVessel = {
  vesselName?: string;
  vesselMaerskCode?: string;
  vesselIMONumber?: string;
};

type MaerskScheduleRow = {
  cityName?: string;
  portName?: string;
  unLocationCode?: string;
  arrivalTime?: string;
  arrivalTimingClassifier?: string;
  departureTime?: string;
  departureTimingClassifier?: string;
  arrivalVoyageNumber?: string;
  departureVoyageNumber?: string;
  departureServiceCode?: string;
};

type SinotransVessel = {
  code: string;
  name: string;
  label: string;
};

type SinotransTimes = {
  planned: string;
  estimated: string;
  actual: string;
};

type SinotransScheduleRow = {
  portName: string;
  arrival: SinotransTimes;
  departure: SinotransTimes;
};

let sinotransVesselMasterCache:
  | { expiresAt: number; promise: Promise<SinotransVessel[]> }
  | undefined;

async function postPancon<T>(
  path: string,
  body: object,
  timeoutMs = 18_000
): Promise<T> {
  const response = await fetchWithTimeout(
    `${PANCON_BASE_URL}/${path}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json; charset=UTF-8",
        Referer: PANCON_SCHEDULE_URL,
        "User-Agent": "Mozilla/5.0 CargoWatch/1.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  if (!response.ok) throw new Error(`官网返回 ${response.status}`);
  return response.json() as Promise<T>;
}

function htmlAttribute(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  return htmlToText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function sinotransCookie(response: Response) {
  return (response.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
    .map((value) => value.trim().split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function sinotransHiddenFields(html: string) {
  const fields = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (htmlAttribute(tag, "type").toLowerCase() !== "hidden") continue;
    const name = htmlAttribute(tag, "name");
    if (name) fields.set(name, htmlAttribute(tag, "value"));
  }
  return fields;
}

async function loadSinotransVesselMaster() {
  const now = Date.now();
  if (
    sinotransVesselMasterCache &&
    sinotransVesselMasterCache.expiresAt > now
  ) {
    return sinotransVesselMasterCache.promise;
  }

  const promise = (async () => {
    const response = await fetchWithTimeout(
      SINOTRANS_VESSEL_LIST_URL,
      {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: SINOTRANS_SCHEDULE_URL,
          "User-Agent": COSCO_BROWSER_USER_AGENT,
        },
      },
      12_000
    );
    if (!response.ok) {
      await response.text();
      throw new Error(`中外运船名库返回 ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, string>;
    return Object.entries(payload).flatMap(([code, label]) => {
      const match = label.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
      const name = (match?.[1] ?? label).trim();
      const officialCode = (match?.[2] ?? code).trim();
      return name && officialCode
        ? [{ code: officialCode, name, label }]
        : [];
    });
  })();

  sinotransVesselMasterCache = {
    expiresAt: now + SINOTRANS_VESSEL_CACHE_MS,
    promise,
  };
  promise.catch(() => {
    if (sinotransVesselMasterCache?.promise === promise) {
      sinotransVesselMasterCache = undefined;
    }
  });
  return promise;
}

async function findSinotransVessel(shipment: TrackingShipment) {
  if (!shipment.vesselName) return undefined;
  const wanted = identifier(
    shipment.vesselName.replace(/\s*\([^()]*\)\s*$/, "")
  );
  if (!wanted) return undefined;
  const vessels = await loadSinotransVesselMaster();
  return vessels.find((vessel) => identifier(vessel.name) === wanted);
}

function sinotransMonthRange(value: string, offset: number) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const anchor = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + offset;
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

function sinotransDateRanges(shipment: TrackingShipment) {
  const anchor =
    shipment.atd ||
    shipment.etd ||
    shipment.baselineEtd ||
    chinaTimestamp().slice(0, 10);
  return [0, 1, -1].map((offset) => sinotransMonthRange(anchor, offset));
}

function parseSinotransTimes(value: string): SinotransTimes {
  const result: SinotransTimes = { planned: "", estimated: "", actual: "" };
  for (const match of value.matchAll(
    /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*\(([PEA])\)/gi
  )) {
    const timestamp = websiteTimestamp(match[1]);
    const classifier = match[2].toUpperCase();
    if (classifier === "P") result.planned = timestamp;
    if (classifier === "E") result.estimated = timestamp;
    if (classifier === "A") result.actual = timestamp;
  }
  return result;
}

function parseSinotransRows(html: string) {
  const rows: SinotransScheduleRow[] = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => htmlToText(cell[1]));
    if (cells.length < 8 || !/^\d+$/.test(cells[0]) || !cells[2]) continue;
    rows.push({
      portName: cells[2],
      arrival: parseSinotransTimes(cells[4]),
      departure: parseSinotransTimes(cells[7]),
    });
  }
  return rows;
}

async function submitSinotransSchedule(
  vessel: SinotransVessel,
  voyage: string,
  range: { from: string; to: string }
) {
  const page = await fetchWithTimeout(
    SINOTRANS_SCHEDULE_URL,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": COSCO_BROWSER_USER_AGENT,
      },
    },
    18_000
  );
  if (!page.ok) {
    await page.text();
    throw new Error(`中外运官网返回 ${page.status}`);
  }
  const cookie = sinotransCookie(page);
  const body = sinotransHiddenFields(await page.text());
  body.set("Calendarfromtime", range.from);
  body.set("Calendartotime", range.to);
  body.set("autocomplete_vsl", vessel.label);
  body.set("TxtVoy", voyage);
  body.set("BTbyvslvoy", "船舶查询");

  const response = await fetchWithTimeout(
    SINOTRANS_SCHEDULE_URL,
    {
      method: "POST",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: SINOTRANS_SCHEDULE_URL,
        "User-Agent": COSCO_BROWSER_USER_AGENT,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
    },
    25_000
  );
  if (!response.ok) {
    await response.text();
    throw new Error(`中外运官网返回 ${response.status}`);
  }
  return response.text();
}

export async function querySinotrans(
  shipment: TrackingShipment
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) {
    throw new Error("缺少船名或航次");
  }
  if (!shipment.portOfLoading || !shipment.portOfDischarge) {
    throw new Error("缺少起运港或目的港");
  }

  const vessel = await findSinotransVessel(shipment);
  if (!vessel) {
    throw new Error(`中外运官网船名库没有找到 ${shipment.vesselName}`);
  }

  let matchedHtml = "";
  let rows: SinotransScheduleRow[] = [];
  const ranges = sinotransDateRanges(shipment);
  const queryRange = async (range: { from: string; to: string }) => {
    const html = await submitSinotransSchedule(vessel, shipment.voyage, range);
    const text = htmlToText(html);
    const exactVesselVoyage = identifier(text).includes(
      identifier(`${vessel.name} V ${shipment.voyage}`)
    );
    return {
      html,
      rows: exactVesselVoyage ? parseSinotransRows(html) : [],
    };
  };
  const firstResult = await queryRange(ranges[0]);
  if (firstResult.rows.length) {
    matchedHtml = firstResult.html;
    rows = firstResult.rows;
  } else {
    // Only after the likely month misses, query the two adjacent months in
    // parallel so an old or future voyage does not add two serial waits.
    const adjacentResults = await Promise.allSettled(
      ranges.slice(1).map(queryRange)
    );
    const adjacentMatch = adjacentResults.find(
      (result) => result.status === "fulfilled" && result.value.rows.length
    );
    if (adjacentMatch?.status === "fulfilled") {
      matchedHtml = adjacentMatch.value.html;
      rows = adjacentMatch.value.rows;
    }
  }
  if (!rows.length) {
    throw new Error(
      `中外运官网已查询，但没有找到 ${shipment.vesselName} / ${shipment.voyage}`
    );
  }

  const pair = orderedPortPair(
    rows,
    (row) => portMatches(row.portName, undefined, shipment.portOfLoading),
    (row) => portMatches(row.portName, undefined, shipment.portOfDischarge)
  );
  if (!pair) {
    throw new Error("中外运官网航次存在，但启运港或目的港不在该航次港序中");
  }

  const baselineEtd =
    shipment.baselineEtd || pair.pol.departure.planned || shipment.etd;
  const etd =
    pair.pol.departure.estimated ||
    pair.pol.departure.planned ||
    shipment.etd;
  const atd = pair.pol.departure.actual || shipment.atd;
  const baselineEta =
    shipment.baselineEta || pair.pod.arrival.planned || shipment.eta;
  const eta =
    pair.pod.arrival.estimated || pair.pod.arrival.planned || shipment.eta;
  const ata = pair.pod.arrival.actual || shipment.ata;
  const effectiveArrival = ata || eta;
  const routeMatch = htmlToText(matchedHtml).match(
    /Schedule Details[\s\S]*?航线\s+(.+?)\s+收起/i
  );

  return {
    vesselName: vessel.name,
    voyage: shipment.voyage,
    portOfLoading: pair.pol.portName,
    portOfDischarge: pair.pod.portName,
    status: atd
      ? scheduleStatus(etd, atd, eta, ata)
      : etd && etd >= chinaTimestamp()
        ? "待开船"
        : "可能延期",
    baselineEtd,
    etd,
    atd,
    baselineEta,
    eta,
    ata,
    delayDays: effectiveArrival
      ? dayDifference(effectiveArrival, baselineEta)
      : shipment.delayDays,
    source: "中外运集运官网船期",
    sourceUrl: SINOTRANS_SCHEDULE_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `中外运官网以 ${vessel.label} 精确匹配航次 ${shipment.voyage} 及有序两港${routeMatch?.[1] ? `；航线 ${routeMatch[1]}` : ""}；计划开航 ${timeLabel(baselineEtd)}，最新${atd ? "实际" : "预计"}开航 ${timeLabel(atd || etd)}；计划到港 ${timeLabel(baselineEta)}，最新${ata ? "实际" : "预计"}到港 ${timeLabel(ata || eta)}。`,
  };
}

function panconPortAlias(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "INCHON") return "INCHEON";
  if (normalized === "PUSAN") return "BUSAN";
  return normalized;
}

type TrackingSession = {
  panconPorts: Map<string, Promise<PanconPort>>;
  panconSchedules: Map<string, Promise<PanconSchedule[]>>;
  carrierSearches: Map<string, Promise<OnlineCarrierIdentification | undefined>>;
  coscoCookie?: Promise<string>;
  coscoVesselCodes: Map<string, Promise<string>>;
  oneVesselCodes: Map<string, Promise<string>>;
  hmmSession?: Promise<HmmSessionData>;
  hmmVessels?: Promise<HmmVessel[]>;
  yangMingVessels?: Promise<YangMingVessel[]>;
  maerskVessels?: Promise<MaerskVessel[]>;
  carrierQueries: Map<string, Promise<TrackingUpdate>>;
};

export function createTrackingSession(): TrackingSession {
  return {
    panconPorts: new Map(),
    panconSchedules: new Map(),
    carrierSearches: new Map(),
    coscoVesselCodes: new Map(),
    oneVesselCodes: new Map(),
    carrierQueries: new Map(),
  };
}

function carrierSearchKey(shipment: TrackingShipment) {
  return [
    identifier(shipment.vesselName),
    identifier(shipment.voyage),
    identifier(shipment.portOfLoading),
    identifier(shipment.portOfDischarge),
  ].join(":");
}

async function findCarrierOnline(
  shipment: TrackingShipment,
  session: TrackingSession
) {
  const key = carrierSearchKey(shipment);
  const cached = session.carrierSearches.get(key);
  if (cached) return cached;
  const request = identifyCarrierOnline(shipment);
  session.carrierSearches.set(key, request);
  request.catch(() => session.carrierSearches.delete(key));
  return request;
}

async function findPanconPort(value: string, session: TrackingSession) {
  if (!value) throw new Error("缺少起运港或目的港");
  const key = panconPortAlias(value);
  const cached = session.panconPorts.get(key);
  if (cached) return cached;

  const request = postPancon<{ list?: PanconPort[] }>("common/plc_cd.pcl", {
    I_AS_COUNTRY_CD: "",
    I_AS_PLC_CAT_CD: "",
    I_AS_PLC_NM: key,
  }).then((data) => {
    const port = data.list?.[0];
    if (!port?.PLC_CD || !port.COUNTRY_CD) {
      throw new Error(`官网无法识别港口 ${value}`);
    }
    return port;
  });
  session.panconPorts.set(key, request);
  request.catch(() => session.panconPorts.delete(key));
  return request;
}

async function loadPanconSchedules(
  pol: PanconPort,
  pod: PanconPort,
  baseDate: string,
  rangeCode: "01" | "05",
  session: TrackingSession
) {
  const key = [
    pol.COUNTRY_CD,
    pol.PLC_CD,
    pod.COUNTRY_CD,
    pod.PLC_CD,
    baseDate,
    rangeCode,
  ].join(":");
  const cached = session.panconSchedules.get(key);
  if (cached) return cached;

  const request = postPancon<{ rows?: PanconSchedule[] }>(
    "selectWeb211.pcl",
    {
      I_AS_POL_CTR1: pol.COUNTRY_CD,
      I_AS_POL_CD1: pol.PLC_CD,
      I_AS_POD_CTR1: pod.COUNTRY_CD,
      I_AS_POD_CD1: pod.PLC_CD,
      I_AS_BASE_DT: baseDate,
      I_AS_WK_CD: rangeCode,
      I_AS_IN_OUT_CD: "O",
    },
    rangeCode === "01" ? 35_000 : 45_000
  ).then((data) => data.rows ?? []);
  session.panconSchedules.set(key, request);
  request.catch(() => session.panconSchedules.delete(key));
  return request;
}

function findPanconSchedule(
  rows: PanconSchedule[],
  vesselKey: string,
  voyageKey: string
) {
  return rows.find(
    (item) =>
      identifier(item.VSL_NM ?? "") === vesselKey &&
      identifier(item.VOY_NO ?? "") === voyageKey
  );
}

async function queryPancon(
  shipment: TrackingShipment,
  session: TrackingSession
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) {
    throw new Error("缺少船名或航次");
  }
  const [pol, pod] = await Promise.all([
    findPanconPort(shipment.portOfLoading, session),
    findPanconPort(shipment.portOfDischarge, session),
  ]);
  const vesselKey = identifier(shipment.vesselName);
  const voyageKey = identifier(shipment.voyage);
  const departureDate = shipment.etd || shipment.atd;
  const arrivalDate = shipment.eta || shipment.ata;
  const primaryBaseDate = departureDate
    ? dateForPanconQuery(departureDate, 4)
    : arrivalDate
      ? dateForPanconQuery(arrivalDate, 7)
      : dateForPanconQuery(undefined, 7);
  const primaryRows = await loadPanconSchedules(
    pol,
    pod,
    primaryBaseDate,
    "01",
    session
  );
  let row = findPanconSchedule(primaryRows, vesselKey, voyageKey);
  if (!row) {
    const monthBaseDate = firstDayOfPanconMonth(
      dateForPanconQuery(departureDate || arrivalDate)
    );
    const monthlyRows = await loadPanconSchedules(
      pol,
      pod,
      monthBaseDate,
      "05",
      session
    );
    row = findPanconSchedule(monthlyRows, vesselKey, voyageKey);
  }
  if (!row) throw new Error("官网船期中未找到相同船名航次");

  const now = chinaTimestamp();
  const etd = parsePanconTimestamp(row.POL_ETD) || shipment.etd;
  const reportedAtd = parsePanconTimestamp(row.ATD);
  const atd =
    (reportedAtd && reportedAtd <= now ? reportedAtd : "") ||
    (shipment.atd && shipment.atd <= now ? shipment.atd : "");
  const eta = parsePanconTimestamp(row.POD_ETA) || shipment.eta;
  const reportedAta = parsePanconTimestamp(row.ATA);
  const ata =
    reportedAta && reportedAta !== eta && reportedAta <= now
      ? reportedAta
      : shipment.ata && shipment.ata !== eta && shipment.ata <= now
        ? shipment.ata
        : "";
  const today = now.slice(0, 10);
  const status = ata
    ? "已到港"
    : atd
      ? eta && eta.slice(0, 10) < today
        ? "可能延期"
        : "运输中"
      : etd && etd.slice(0, 10) < today
        ? "可能延期"
        : "待开船";
  const delayDays = ata
    ? dayDifference(ata, eta)
    : eta && eta.slice(0, 10) < today
      ? dayDifference(today, eta)
      : 0;
  const movement = ata
    ? `实际抵达 ${row.POD ?? shipment.portOfDischarge} ${timeLabel(ata)}`
    : atd
      ? `实际从 ${row.POL ?? shipment.portOfLoading} 开航 ${timeLabel(atd)}`
      : `计划从 ${row.POL ?? shipment.portOfLoading} 开航 ${timeLabel(etd)}`;

  return {
    vesselName: row.VSL_NM || shipment.vesselName,
    voyage: row.VOY_NO || shipment.voyage,
    portOfLoading: row.POL || shipment.portOfLoading,
    portOfDischarge: row.POD || shipment.portOfDischarge,
    status,
    etd,
    atd,
    eta,
    ata,
    delayDays,
    source: "PANCON 官网船期",
    sourceUrl: PANCON_SCHEDULE_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `PANCON 官网最新记录：${movement}；计划到港 ${timeLabel(eta)}。`,
  };
}

function cookieHeaderFromResponse(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = headers.getSetCookie?.() ??
    (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  return values
    .flatMap((value) => value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/))
    .map((value) => value.split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function coscoSessionCookie(session: TrackingSession) {
  if (session.coscoCookie) return session.coscoCookie;
  const request = fetchWithTimeout(
    COSCO_GLOBAL_SEARCH_URL,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent": COSCO_BROWSER_USER_AGENT,
      },
      redirect: "follow",
    },
    22_000
  ).then(async (response) => {
    const cookie = cookieHeaderFromResponse(response);
    await response.text();
    if (!response.ok) {
      throw new Error(`COSCO 全球官网返回 ${response.status}`);
    }
    if (!cookie) {
      throw new Error("COSCO 全球官网未建立查询会话");
    }
    return cookie;
  });
  session.coscoCookie = request;
  request.catch(() => {
    session.coscoCookie = undefined;
  });
  return request;
}

async function coscoGetJson<T>(
  url: string,
  referer: string,
  session: TrackingSession
): Promise<T> {
  const cookie = await coscoSessionCookie(session);
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Cookie: cookie,
        Referer: referer,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": COSCO_BROWSER_USER_AGENT,
      },
    },
    22_000
  );
  if (!response.ok) {
    await response.text();
    throw new Error(`COSCO 全球官网返回 ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.text();
    throw new Error("COSCO 全球官网安全校验未通过");
  }
  return response.json() as Promise<T>;
}

async function findCoscoVesselCode(
  vesselName: string,
  session: TrackingSession
) {
  const key = identifier(vesselName);
  const cached = session.coscoVesselCodes.get(key);
  if (cached) return cached;

  const request = (async () => {
    const params = new URLSearchParams({ prefix: vesselName.trim() });
    const data = await coscoGetJson<{
      data?: { content?: CoscoVesselMatch[] };
    }>(
      `${COSCO_VESSEL_LOOKUP_URL}?${params.toString()}`,
      COSCO_GLOBAL_SEARCH_URL,
      session
    );
    const match = (data.data?.content ?? []).find(
      (item) => identifier(item.description ?? "") === key
    );
    if (!match?.code) {
      throw new Error(`COSCO 全球官网没有找到船名 ${vesselName}`);
    }
    return match.code;
  })();
  session.coscoVesselCodes.set(key, request);
  request.catch(() => session.coscoVesselCodes.delete(key));
  return request;
}

function coscoPortKey(value: string) {
  const key = identifier(value.split(",", 1)[0] ?? value);
  if (key === "INCHEON") return "INCHON";
  if (key === "PUSAN") return "BUSAN";
  return key;
}

function findCoscoPortRow(rows: CoscoGlobalSchedule[], port: string) {
  const key = coscoPortKey(port);
  return rows.find((row) => coscoPortKey(row.protName ?? "") === key);
}

async function queryCoscoGlobal(
  shipment: TrackingShipment,
  session: TrackingSession,
  context?: CarrierQueryContext
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) {
    throw new Error("缺少船名或航次");
  }

  const vesselCode = await findCoscoVesselCode(shipment.vesselName, session);
  const params = new URLSearchParams({
    vesselCode,
    period: "28",
    vesselName: shipment.vesselName.trim(),
  });
  const data = await coscoGetJson<{
    data?: { content?: { data?: CoscoGlobalSchedule[] } };
  }>(
    `${COSCO_VESSEL_SCHEDULE_URL}?${params.toString()}`,
    COSCO_GLOBAL_RESULT_URL,
    session
  );
  const rows = data.data?.content?.data ?? [];
  const voyageKey = identifier(shipment.voyage);
  const groups: CoscoGlobalSchedule[][] = [];
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
  );
  const aliasGroups = context?.allowVoyageAlias
    ? groups
        .map((group) => {
          const pair = orderedPortPair(
            group,
            (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfLoading),
            (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfDischarge)
          );
          return {
            group,
            pair,
            distance: pair
              ? crossCarrierScheduleDistance(
                  shipment,
                  pair.pol.depDtlocCos ?? undefined,
                  pair.pod.arrDtlocCos ?? undefined
                )
              : Number.POSITIVE_INFINITY,
          };
        })
        .filter((candidate) => candidate.pair && candidate.distance <= 35)
        .sort((left, right) => left.distance - right.distance)
    : [];
  const exactGroupHasRoute = exactGroup
    ? Boolean(orderedPortPair(
        exactGroup,
        (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfLoading),
        (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfDischarge)
      ))
    : false;
  const exactPol = exactGroup?.find(
    (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfLoading)
  );
  const allowOoclInlandContinuation = Boolean(
    context?.allowVoyageAlias &&
      context.primaryCarrier?.id === "oocl" &&
      exactGroup &&
      exactPol &&
      !exactGroupHasRoute
  );
  const voyageRows = exactGroupHasRoute || allowOoclInlandContinuation
    ? exactGroup
    : aliasGroups[0]?.group;
  if (!voyageRows) {
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
  }

  const header = voyageRows[0];
  const pair = orderedPortPair(
    voyageRows,
    (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfLoading),
    (row) => coscoPortKey(row.protName ?? "") === coscoPortKey(shipment.portOfDischarge)
  );
  if (!pair && !allowOoclInlandContinuation) {
    throw new Error("COSCO 官网航次存在，但启运港或目的港不在同一有序港序中");
  }
  const pol = pair?.pol ?? exactPol;
  const pod = pair?.pod;
  if (!pol) throw new Error("COSCO 官网航次存在，但没有找到启运港");
  const now = chinaTimestamp();
  const etd = pol.depDtlocCos || shipment.etd;
  const eta = pod?.arrDtlocCos || shipment.eta;
  const reportedAtd = pol.depDtlocAct || "";
  const reportedAta = pod?.arrDtlocAct || "";
  const atd =
    reportedAtd && reportedAtd <= now
      ? reportedAtd
      : shipment.atd && shipment.atd <= now
        ? shipment.atd
        : "";
  const ata =
    reportedAta && reportedAta <= now
      ? reportedAta
      : shipment.ata && shipment.ata <= now
        ? shipment.ata
        : "";
  const status = ata
    ? "已到港"
    : atd
      ? eta && eta < now
        ? "可能延期"
        : "运输中"
      : etd && etd >= now
        ? "待开船"
        : eta && eta >= now
          ? "运输中"
          : "可能延期";
  const delayDays = eta
    ? Math.max(shipment.delayDays, dayDifference(eta, shipment.eta))
    : etd
      ? Math.max(
          shipment.delayDays,
          dayDifference(etd, shipment.baselineEtd || shipment.etd)
        )
      : shipment.delayDays;
  const movement = ata
    ? `实际到达 ${pod?.protName || shipment.portOfDischarge} ${timeLabel(ata)}`
    : atd
      ? `实际从 ${pol.protName || shipment.portOfLoading} 开航 ${timeLabel(atd)}`
      : `计划从 ${pol.protName || shipment.portOfLoading} 开航 ${timeLabel(etd)}`;
  const route = header.loopAbbrv ? `；航线 ${header.loopAbbrv}` : "";
  const officialVoyage = header.voy ? `；官网航次 ${header.voy}` : "";
  const aliasNote = context?.allowVoyageAlias
    ? partnerVoyageNote(shipment.voyage, header.voy)
    : "";
  const inlandNote = allowOoclInlandContinuation
    ? `；${shipment.portOfDischarge} 为内陆目的地，远洋挂港表不直接列出该地点，本次先更新海运干线开航信息`
    : "";

  return {
    vesselName: header.vesselName || shipment.vesselName,
    voyage: context?.allowVoyageAlias && header.voy
      ? header.voy.split("/", 1)[0].trim()
      : shipment.voyage,
    portOfLoading: pol.protName || shipment.portOfLoading,
    portOfDischarge: pod?.protName || shipment.portOfDischarge,
    status,
    etd,
    atd,
    eta,
    ata,
    delayDays,
    source: "COSCO eLines 全球官网船期",
    sourceUrl: COSCO_GLOBAL_RESULT_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `COSCO 全球官网最新记录：${movement}${pod ? `；计划到达 ${pod.protName || shipment.portOfDischarge} ${timeLabel(eta)}` : ""}${route}${officialVoyage}${aliasNote}${inlandNote}。`,
  };
}

function schedulePortKey(value?: string) {
  const raw = (value ?? "").split(",", 1)[0];
  const key = identifier(raw);
  if (key === "INCHON") return "INCHEON";
  if (key === "PUSAN") return "BUSAN";
  return key;
}

function portMatches(name: string | undefined, code: string | undefined, input: string) {
  const wanted = schedulePortKey(input);
  return Boolean(
    wanted &&
      (schedulePortKey(name) === wanted || schedulePortKey(code) === wanted)
  );
}

function websiteTimestamp(value?: string) {
  if (!value || value.toUpperCase() === "SKIP") return "";
  const normalized = value.replaceAll("/", "-").replace("T", " ").trim();
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
  return match ? `${match[1]}${match[2] ? ` ${match[2]}` : ""}` : "";
}

function scheduleStatus(etd: string, atd: string, eta: string, ata: string) {
  const now = chinaTimestamp();
  if (ata) return "已到港";
  if (atd) return eta && eta < now ? "可能延期" : "运输中";
  if (etd && etd >= now) return "待开船";
  if (eta && eta >= now) return "运输中";
  return "可能延期";
}

function voyageNumberKey(value?: string) {
  const digits = (value ?? "").match(/\d+/)?.[0] ?? "";
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
}

function exactVoyageMatch(official: string | undefined, requested: string) {
  const wanted = identifier(requested);
  return (official ?? "")
    .split("/")
    .some((value) => identifier(value) === wanted);
}

function dateDistanceDays(left?: string, right?: string) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const leftTime = Date.parse(`${left.slice(0, 10)}T00:00:00Z`);
  const rightTime = Date.parse(`${right.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function crossCarrierScheduleDistance(
  shipment: TrackingShipment,
  candidateEtd?: string,
  candidateEta?: string
) {
  const departureAnchors = [shipment.atd, shipment.etd, shipment.baselineEtd]
    .filter(Boolean);
  const arrivalAnchors = [shipment.ata, shipment.eta, shipment.baselineEta]
    .filter(Boolean);
  const distances = [
    ...(candidateEtd
      ? departureAnchors.map((value) => dateDistanceDays(candidateEtd, value))
      : []),
    ...(candidateEta
      ? arrivalAnchors.map((value) => dateDistanceDays(candidateEta, value))
      : []),
  ].filter(Number.isFinite);
  return distances.length ? Math.min(...distances) : Number.POSITIVE_INFINITY;
}

function crossCarrierScheduleMatches(
  shipment: TrackingShipment,
  candidateEtd?: string,
  candidateEta?: string
) {
  // A partner may publish its own voyage number. Never accept that alias from
  // the vessel name alone: at least one known ETD/ETA must be within 35 days.
  return crossCarrierScheduleDistance(shipment, candidateEtd, candidateEta) <= 35;
}

function orderedPortPair<T>(
  rows: T[],
  polMatches: (row: T) => boolean,
  podMatches: (row: T) => boolean
) {
  const polIndex = rows.findIndex(polMatches);
  if (polIndex < 0) return undefined;
  const podOffset = rows.slice(polIndex + 1).findIndex(podMatches);
  if (podOffset < 0) return undefined;
  return {
    pol: rows[polIndex],
    pod: rows[polIndex + 1 + podOffset],
  };
}

function partnerVoyageNote(requested: string, official?: string) {
  if (!official || exactVoyageMatch(official, requested)) return "";
  return `；原航次 ${requested}，合作方航次 ${official}`;
}

function offsetIsoDate(value: string, days: number) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const date = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maerskDateRange(shipment: TrackingShipment) {
  const today = chinaTimestamp().slice(0, 10);
  const anchor = shipment.atd || shipment.etd || shipment.eta || today;
  const fromDate = offsetIsoDate(anchor, -90);
  const desiredEnd = [today, shipment.eta, shipment.ata]
    .filter(Boolean)
    .sort()
    .at(-1) || today;
  const requestedEnd = offsetIsoDate(desiredEnd, 90);
  const maximumEnd = offsetIsoDate(fromDate, 300);
  return {
    fromDate,
    toDate: requestedEnd < maximumEnd ? requestedEnd : maximumEnd,
  };
}

async function maerskGetJson<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${MAERSK_API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "Consumer-Key": MAERSK_CONSUMER_KEY,
      Referer: MAERSK_SCHEDULE_URL,
      "User-Agent": COSCO_BROWSER_USER_AGENT,
    },
  }, 25_000);
  if (!response.ok) {
    await response.text();
    throw new Error(`Maersk 全球官网返回 ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.text();
    throw new Error("Maersk 全球官网没有返回船期数据");
  }
  return response.json() as Promise<T>;
}

async function loadMaerskVessels(session: TrackingSession) {
  if (!session.maerskVessels) {
    session.maerskVessels = maerskGetJson<{ vessels?: MaerskVessel[] }>(
      "/synergy/schedules/active-vessels?carrierCodes=MAEU"
    ).then((data) => data.vessels ?? []);
    session.maerskVessels.catch(() => { session.maerskVessels = undefined; });
  }
  return session.maerskVessels;
}

async function queryMaersk(
  shipment: TrackingShipment,
  session: TrackingSession,
  context?: CarrierQueryContext
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) throw new Error("缺少船名或航次");
  if (!shipment.portOfLoading || !shipment.portOfDischarge) {
    throw new Error("缺少起运港或目的港");
  }

  const vesselKey = identifier(shipment.vesselName);
  const matches = (await loadMaerskVessels(session)).filter(
    (vessel) =>
      identifier(vessel.vesselName ?? "") === vesselKey &&
      Boolean(vessel.vesselMaerskCode)
  );
  if (!matches.length) {
    throw new Error(`Maersk 全球官网没有找到船名 ${shipment.vesselName}`);
  }

  const { fromDate, toDate } = maerskDateRange(shipment);
  const candidates: Array<{
    pol: MaerskScheduleRow;
    pod: MaerskScheduleRow;
    vessel: MaerskVessel;
    exact: boolean;
    distance: number;
  }> = [];
  for (const vessel of matches.slice(0, 4)) {
    const params = new URLSearchParams({
      vesselMaerskCode: vessel.vesselMaerskCode ?? "",
      fromDate,
      toDate,
      carrierCodes: "MAEU",
    });
    const data = await maerskGetJson<{ vesselSchedules?: MaerskScheduleRow[] }>(
      `/synergy/schedules/vessel-schedules?${params.toString()}`
    );
    const rows = data.vesselSchedules ?? [];
    for (let index = 0; index < rows.length; index += 1) {
      const pol = rows[index];
      if (!portMatches(
        pol.portName || pol.cityName,
        pol.unLocationCode,
        shipment.portOfLoading
      )) continue;
      const pod = rows.slice(index + 1).find(
        (row) =>
          portMatches(
            row.portName || row.cityName,
            row.unLocationCode,
            shipment.portOfDischarge
          )
      );
      if (pod) {
        const exact =
          exactVoyageMatch(pol.departureVoyageNumber, shipment.voyage) &&
          exactVoyageMatch(pod.arrivalVoyageNumber, shipment.voyage);
        const etd = websiteTimestamp(pol.departureTime);
        const eta = websiteTimestamp(pod.arrivalTime);
        if (
          exact ||
          (context?.allowVoyageAlias &&
            crossCarrierScheduleMatches(shipment, etd, eta))
        ) {
          candidates.push({
            pol,
            pod,
            vessel,
            exact,
            distance: crossCarrierScheduleDistance(shipment, etd, eta),
          });
        }
      }
    }
  }

  const selected = candidates.sort((left, right) => {
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    return left.distance - right.distance;
  })[0];

  if (!selected) {
    throw new Error("Maersk 官网已查询，但没有同时匹配船名、航次及两港的船期");
  }

  const etd = websiteTimestamp(selected.pol.departureTime) || shipment.etd;
  const eta = websiteTimestamp(selected.pod.arrivalTime) || shipment.eta;
  const atd = selected.pol.departureTimingClassifier === "ACTUAL" ? etd : "";
  const ata = selected.pod.arrivalTimingClassifier === "ACTUAL" ? eta : "";
  const partnerVoyage = selected.pol.departureVoyageNumber ||
    selected.pod.arrivalVoyageNumber || shipment.voyage;
  const polName = selected.pol.portName || selected.pol.cityName || shipment.portOfLoading;
  const podName = selected.pod.portName || selected.pod.cityName || shipment.portOfDischarge;
  return {
    vesselName: selected.vessel.vesselName || shipment.vesselName,
    voyage: context?.allowVoyageAlias ? partnerVoyage : shipment.voyage,
    portOfLoading: polName,
    portOfDischarge: podName,
    status: scheduleStatus(etd, atd, eta, ata),
    etd,
    atd,
    eta,
    ata,
    delayDays: eta ? Math.max(0, dayDifference(eta, shipment.eta)) : shipment.delayDays,
    source: "Maersk 全球官网船期",
    sourceUrl: MAERSK_SCHEDULE_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `Maersk 官网匹配船名及有序两港${partnerVoyageNote(shipment.voyage, partnerVoyage)}；${atd ? `实际开航 ${timeLabel(atd)}` : `计划开航 ${timeLabel(etd)}`}，${ata ? `实际到港 ${timeLabel(ata)}` : `计划到港 ${timeLabel(eta)}`}${selected.pol.departureServiceCode ? `；航线 ${selected.pol.departureServiceCode}` : ""}。`,
  };
}

async function oneGetJson<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${ONE_API_BASE}${path}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: ONE_SCHEDULE_URL,
      "User-Agent": COSCO_BROWSER_USER_AGENT,
    },
  }, 20_000);
  if (!response.ok) {
    await response.text();
    throw new Error(`ONE 全球官网返回 ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.text();
    throw new Error("ONE 全球官网没有返回船期数据");
  }
  return response.json() as Promise<T>;
}

async function findOneVesselCode(vesselName: string, session: TrackingSession) {
  const key = identifier(vesselName);
  const cached = session.oneVesselCodes.get(key);
  if (cached) return cached;
  const request = oneGetJson<{ vessels?: OneVessel[] }>(
    `/v2/schedule/vessels?vesselName=${encodeURIComponent(vesselName.trim())}`
  ).then((data) => {
    const match = (data.vessels ?? []).find(
      (vessel) => identifier(vessel.name ?? "") === key
    );
    if (!match?.code) throw new Error(`ONE 全球官网没有找到船名 ${vesselName}`);
    return match.code;
  });
  session.oneVesselCodes.set(key, request);
  request.catch(() => session.oneVesselCodes.delete(key));
  return request;
}

async function queryOne(
  shipment: TrackingShipment,
  session: TrackingSession,
  context?: CarrierQueryContext
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) throw new Error("缺少船名或航次");
  if (!shipment.portOfLoading || !shipment.portOfDischarge) {
    throw new Error("缺少起运港或目的港");
  }
  const vesselCode = await findOneVesselCode(shipment.vesselName, session);
  const voyageData = await oneGetJson<{ voyageNos?: OneVoyage[] }>(
    `/v1/schedule/vessel/voyage-list?vesselCode=${encodeURIComponent(vesselCode)}`
  );
  const wantedNumber = voyageNumberKey(shipment.voyage);
  const exactCandidates = (voyageData.voyageNos ?? []).filter(
    (voyage) => voyageNumberKey(voyage.scheduleVoyageNumber) === wantedNumber
  );
  const remainingCandidates = (voyageData.voyageNos ?? []).filter(
    (voyage) => !exactCandidates.includes(voyage)
  );
  const candidates = context?.allowVoyageAlias
    ? [...exactCandidates, ...remainingCandidates].slice(0, 6)
    : exactCandidates.slice(0, 3);
  if (!candidates.length) {
    throw new Error("ONE 全球官网已查询，但没有相同航次");
  }

  const loadedResults = await Promise.allSettled(
    candidates.map(async (candidate) => {
      if (!candidate.scheduleVoyageNumber) return undefined;
      const params = new URLSearchParams({
        vesselCode,
        voyageNo: candidate.scheduleVoyageNumber,
        cargoNature: "GP",
      });
      const data = await oneGetJson<{ scheduleLines?: OneScheduleLine[] }>(
        `/v1/schedule/vessel/port-list?${params.toString()}`
      );
      return { candidate, rows: data.scheduleLines ?? [] };
    })
  );
  const loadedCandidates = loadedResults.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : []
  );
  const selections: Array<{
    rows: OneScheduleLine[];
    voyage: string;
    pair: { pol: OneScheduleLine; pod: OneScheduleLine };
    exact: boolean;
    distance: number;
  }> = [];
  for (const loaded of loadedCandidates) {
    if (!loaded?.candidate.scheduleVoyageNumber) continue;
    const voyageLabels = Array.from(new Set([
      loaded.candidate.scheduleVoyageNumber,
      ...loaded.rows.map((row) => row.consortiumVoyageNumber ?? "").filter(Boolean),
    ]));
    for (const officialVoyage of voyageLabels) {
      const groupedRows = loaded.rows.filter((row) =>
        identifier(row.consortiumVoyageNumber ?? row.scheduleVoyageNumber ?? "") ===
          identifier(officialVoyage) ||
        (!row.consortiumVoyageNumber &&
          row.scheduleVoyageNumber === loaded.candidate.scheduleVoyageNumber)
      );
      const pair = orderedPortPair(
        groupedRows,
        (row) => portMatches(row.portName, row.portCode, shipment.portOfLoading),
        (row) => portMatches(row.portName, row.portCode, shipment.portOfDischarge)
      );
      if (!pair) continue;
      const exact = exactVoyageMatch(officialVoyage, shipment.voyage) ||
        identifier(loaded.candidate.scheduleVoyageNumber) === identifier(shipment.voyage);
      const etd = websiteTimestamp(pair.pol.departureDateTime);
      const eta = websiteTimestamp(pair.pod.arrivalDateTime);
      if (
        exact ||
        (context?.allowVoyageAlias && crossCarrierScheduleMatches(shipment, etd, eta))
      ) {
        selections.push({
          rows: groupedRows,
          voyage: officialVoyage,
          pair,
          exact,
          distance: crossCarrierScheduleDistance(shipment, etd, eta),
        });
      }
    }
  }
  const selected = selections.sort((left, right) => {
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    return left.distance - right.distance;
  })[0];
  if (!selected) throw new Error("ONE 全球官网已查询，但没有相同船名航次");

  const { pol, pod } = selected.pair;
  const etd = websiteTimestamp(pol.departureDateTime) || shipment.etd;
  const eta = websiteTimestamp(pod.arrivalDateTime) || shipment.eta;
  const atd = pol.departureStatus === "A" ? websiteTimestamp(pol.departureDateTime) : "";
  const ata = pod.arrivalStatus === "A" ? websiteTimestamp(pod.arrivalDateTime) : "";
  const status = scheduleStatus(etd, atd, eta, ata);
  return {
    vesselName: shipment.vesselName,
    voyage: context?.allowVoyageAlias ? selected.voyage : shipment.voyage,
    portOfLoading: pol.portName || shipment.portOfLoading,
    portOfDischarge: pod.portName || shipment.portOfDischarge,
    status,
    etd,
    atd,
    eta,
    ata,
    delayDays: eta ? Math.max(0, dayDifference(eta, shipment.eta)) : shipment.delayDays,
    source: "ONE 全球官网船期",
    sourceUrl: ONE_SCHEDULE_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `ONE 官网匹配船名及有序两港${partnerVoyageNote(shipment.voyage, selected.voyage)}；${atd ? `实际开航 ${timeLabel(atd)}` : `计划开航 ${timeLabel(etd)}`}，计划到港 ${timeLabel(eta)}${pol.vesselServiceLaneCode ? `；航线 ${pol.vesselServiceLaneCode}` : ""}。`,
  };
}

async function hmmSessionData(session: TrackingSession) {
  if (session.hmmSession) return session.hmmSession;
  const request = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const url = attempt === 0
        ? HMM_SCHEDULE_URL
        : `${HMM_SCHEDULE_URL}?refresh=${Date.now()}`;
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "User-Agent": COSCO_BROWSER_USER_AGENT,
        },
      }, 12_000);
      const cookie = cookieHeaderFromResponse(response);
      const html = await response.text();
      if (response.ok) {
        const csrf = html.match(/<meta\s+name=["']_csrf["']\s+content=["']([^"']+)["']/i)?.[1];
        if (!cookie || !csrf) throw new Error("HMM 全球官网未建立有效查询会话");
        return { cookie, csrf };
      }
      if (attempt === 1 || response.status < 500) {
        throw new Error(`HMM 全球官网返回 ${response.status}`);
      }
    }
    throw new Error("HMM 全球官网查询失败");
  })();
  session.hmmSession = request;
  request.catch(() => { session.hmmSession = undefined; });
  return request;
}

async function hmmPost<T>(path: string, body: object, session: TrackingSession) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const auth = await hmmSessionData(session);
    const response = await fetchWithTimeout(`${HMM_BASE_URL}/${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Content-Type": "application/json; charset=UTF-8",
        Cookie: auth.cookie,
        Origin: "https://www.hmm21.com",
        Pragma: "no-cache",
        Referer: HMM_SCHEDULE_URL,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": COSCO_BROWSER_USER_AGENT,
        "X-CSRF-TOKEN": auth.csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(body),
    }, 12_000);
    if (response.ok) return response.json() as Promise<T>;
    await response.text();
    if (attempt === 1 || response.status < 500) {
      throw new Error(`HMM 全球官网返回 ${response.status}`);
    }
    session.hmmSession = undefined;
  }
  throw new Error("HMM 全球官网查询失败");
}

async function loadHmmVessels(session: TrackingSession) {
  if (session.hmmVessels) return session.hmmVessels;
  const request = hmmPost<{
    RTN_STS?: string;
    RTN_JSON1?: HmmVessel[];
    RTN_DATA?: { RTN_JSON1?: HmmVessel[] };
  }>(
    "selectScheduleOptionJson.do", {}, session
  ).then((data) => {
    if (data.RTN_STS !== "OK") throw new Error("HMM 全球官网船名表查询失败");
    return data.RTN_DATA?.RTN_JSON1 ?? data.RTN_JSON1 ?? [];
  });
  session.hmmVessels = request;
  request.catch(() => { session.hmmVessels = undefined; });
  return request;
}

function hmmVoyageFamily(value?: string) {
  let key = identifier(value ?? "");
  if (/^[A-Z]{4}\d/.test(key)) key = key.slice(4);
  key = key.replace(/[EWNS]$/, "").replace(/^0+/, "");
  return key;
}

async function queryHmm(
  shipment: TrackingShipment,
  session: TrackingSession,
  context?: CarrierQueryContext
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) throw new Error("缺少船名或航次");
  if (!shipment.portOfLoading || !shipment.portOfDischarge) throw new Error("缺少起运港或目的港");
  const vessels = await loadHmmVessels(session);
  const vessel = vessels.find(
    (item) => identifier(item.optNm ?? "") === identifier(shipment.vesselName)
  );
  if (!vessel?.optCd) throw new Error(`HMM 全球官网没有找到船名 ${shipment.vesselName}`);
  type HmmScheduleResponse = {
    RTN_STS?: string;
    boardList?: HmmScheduleRow[];
    RTN_DATA?: { boardList?: HmmScheduleRow[] };
  };
  // HMM's current public form returns the commercial voyage (0118E) only when
  // the vessel's schedule page is requested without the internal VVD filter.
  // Asking for the commercial value first returns an empty page, so go straight
  // to the one request that the website itself reliably renders.
  const data = await hmmPost<HmmScheduleResponse>("selectByVesselPagingList.do", {
    page: 1,
    srchByVesselVslCd: vessel.optCd,
    vvdCd: "",
  }, session);
  if (data.RTN_STS !== "OK") throw new Error("HMM 全球官网船期查询失败");
  const allRows = data.RTN_DATA?.boardList ?? data.boardList ?? [];
  const rows = allRows.filter(
    (row) => exactVoyageMatch(row.voyInfo, shipment.voyage) || exactVoyageMatch(row.ptnVoyInfo, shipment.voyage)
  );
  const groups = new Map<string, { voyage: string; rows: HmmScheduleRow[] }>();
  for (const row of allRows) {
    const voyage = row.voyInfo || row.ptnVoyInfo || row.ltdvvd || "";
    // A single physical sailing can switch from 0118E at Asian load ports to
    // 0118W at Latin-American discharge ports. Group by the numeric voyage
    // family so the ordered POL/POD pair stays together across that switch.
    const key = hmmVoyageFamily(voyage);
    if (!key) continue;
    const group = groups.get(key) ?? { voyage, rows: [] };
    group.rows.push(row);
    const exactRow = group.rows.find(
      (item) => exactVoyageMatch(item.voyInfo, shipment.voyage) ||
        exactVoyageMatch(item.ptnVoyInfo, shipment.voyage)
    );
    if (exactRow) group.voyage = exactRow.voyInfo || exactRow.ptnVoyInfo || group.voyage;
    groups.set(key, group);
  }
  const selections = Array.from(groups.values()).flatMap((group) => {
    const pair = orderedPortPair(
      group.rows,
      (row) => portMatches(row.portNm, row.portCd, shipment.portOfLoading),
      (row) => portMatches(row.portNm, row.portCd, shipment.portOfDischarge)
    );
    if (!pair) return [];
    const exact = group.rows.some(
      (row) => exactVoyageMatch(row.voyInfo, shipment.voyage) ||
        exactVoyageMatch(row.ptnVoyInfo, shipment.voyage)
    );
    const etd = websiteTimestamp(pair.pol.depDt);
    const eta = websiteTimestamp(pair.pod.arrDt);
    if (!exact && !(context?.allowVoyageAlias && crossCarrierScheduleMatches(shipment, etd, eta))) {
      return [];
    }
    return [{
      voyage: group.voyage,
      pair,
      exact,
      distance: crossCarrierScheduleDistance(shipment, etd, eta),
    }];
  }).sort((left, right) => {
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    return left.distance - right.distance;
  });
  const selected = selections[0];
  if (!selected) {
    if (rows.length || groups.has(hmmVoyageFamily(shipment.voyage))) {
      throw new Error("HMM 官网航次存在，但启运港或目的港不在该航次港序中");
    }
    throw new Error("HMM 全球官网已查询，但没有相同航次或可信共舱别名");
  }
  const { pol, pod } = selected.pair;
  const etd = websiteTimestamp(pol.depDt) || shipment.etd;
  const eta = websiteTimestamp(pod.arrDt) || shipment.eta;
  const atd = pol.depStNm?.toLowerCase() === "actual" ? websiteTimestamp(pol.depDt) : "";
  const ata = pod.arrStNm?.toLowerCase() === "actual" ? websiteTimestamp(pod.arrDt) : "";
  return {
    vesselName: pol.ltdvds || shipment.vesselName,
    voyage: selected.voyage || shipment.voyage,
    portOfLoading: pol.portNm || shipment.portOfLoading,
    portOfDischarge: pod.portNm || shipment.portOfDischarge,
    status: scheduleStatus(etd, atd, eta, ata),
    etd,
    atd,
    eta,
    ata,
    delayDays: eta ? Math.max(0, dayDifference(eta, shipment.eta)) : shipment.delayDays,
    source: "HMM 全球官网船期",
    sourceUrl: HMM_SCHEDULE_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `HMM 官网匹配船名及有序两港${partnerVoyageNote(shipment.voyage, selected.voyage)}；${atd ? `实际开航 ${timeLabel(atd)}` : `计划开航 ${timeLabel(etd)}`}，计划到港 ${timeLabel(eta)}${pol.vslSvcLoopCd ? `；航线 ${pol.vslSvcLoopCd}` : ""}。`,
  };
}

async function yangMingGet<T>(path: string): Promise<T> {
  const response = await fetchWithTimeout(`${YANG_MING_API_BASE}/${path}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: YANG_MING_SCHEDULE_URL,
      "User-Agent": COSCO_BROWSER_USER_AGENT,
    },
  }, 22_000);
  if (!response.ok) {
    await response.text();
    throw new Error(`Yang Ming 全球官网返回 ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.text();
    throw new Error("Yang Ming 全球官网安全校验未通过");
  }
  return response.json() as Promise<T>;
}

function yangMingVoyageMatches(status: YangMingStatus, voyage: string) {
  const detail = status.detailedVesselPosition ?? status.latestVesselPosition;
  return exactVoyageMatch(detail?.currentComnVoyage, voyage) ||
    exactVoyageMatch(detail?.currentYMLVslVoy, voyage);
}

async function queryYangMing(
  shipment: TrackingShipment,
  session: TrackingSession,
  context?: CarrierQueryContext
): Promise<TrackingUpdate> {
  if (!shipment.vesselName || !shipment.voyage) throw new Error("缺少船名或航次");
  if (!shipment.portOfLoading || !shipment.portOfDischarge) throw new Error("缺少起运港或目的港");
  if (!session.yangMingVessels) {
    session.yangMingVessels = yangMingGet<YangMingVessel[]>("GetVessels");
    session.yangMingVessels.catch(() => { session.yangMingVessels = undefined; });
  }
  const vessels = await session.yangMingVessels;
  const vessel = vessels.find(
    (item) => identifier(item.vesselName ?? "") === identifier(shipment.vesselName)
  );
  if (!vessel?.vesselCode) throw new Error(`Yang Ming 全球官网没有找到船名 ${shipment.vesselName}`);
  const current = await yangMingGet<YangMingStatus>(
    `GetVesselStatus?vesselCode=${encodeURIComponent(vessel.vesselCode)}`
  );
  const statuses = [current];
  const nowUsingVoy = current.detailedVesselPosition?.nowUsingVslVoy ??
    current.latestVesselPosition?.nowUsingVslVoy;
  if (nowUsingVoy && (!yangMingVoyageMatches(current, shipment.voyage) || context?.allowVoyageAlias)) {
    const base = `vesselCode=${encodeURIComponent(vessel.vesselCode)}&nowUsingVoy=${encodeURIComponent(nowUsingVoy)}`;
    const adjacent = await Promise.allSettled([
      yangMingGet<YangMingStatus>(`GetVesselStatus?${base}&func=P`),
      yangMingGet<YangMingStatus>(`GetVesselStatus?${base}&func=F`),
    ]);
    statuses.push(...adjacent.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    ));
  }
  const selections = statuses.flatMap((status) => {
    const detail = status.detailedVesselPosition ?? status.latestVesselPosition;
    const pair = orderedPortPair(
      detail?.berthDetail ?? [],
      (row) => portMatches(row.portName, row.portCode, shipment.portOfLoading),
      (row) => portMatches(row.portName, row.portCode, shipment.portOfDischarge)
    );
    if (!detail || !pair) return [];
    const exact = yangMingVoyageMatches(status, shipment.voyage);
    const etd = websiteTimestamp(pair.pol.departureDate);
    const eta = websiteTimestamp(pair.pod.arrivalDate);
    if (!exact && !(context?.allowVoyageAlias && crossCarrierScheduleMatches(shipment, etd, eta))) {
      return [];
    }
    const voyage = detail.currentComnVoyage || detail.currentYMLVslVoy || shipment.voyage;
    return [{
      status,
      detail,
      pair,
      voyage,
      exact,
      distance: crossCarrierScheduleDistance(shipment, etd, eta),
    }];
  }).sort((left, right) => {
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    return left.distance - right.distance;
  });
  const selected = selections[0];
  if (!selected) {
    if (statuses.some((status) => yangMingVoyageMatches(status, shipment.voyage))) {
      throw new Error("Yang Ming 官网航次存在，但启运港或目的港不在该航次港序中");
    }
    throw new Error("Yang Ming 全球官网已查询，但当前及相邻船期没有相同航次或可信共舱别名");
  }
  const { detail, pair, status: matched } = selected;
  const { pol, pod } = pair;
  const etd = websiteTimestamp(pol.departureDate) || shipment.etd;
  const eta = websiteTimestamp(pod.arrivalDate) || shipment.eta;
  const atd = pol.departureStatus?.toLowerCase() === "actual" ? websiteTimestamp(pol.departureDate) : "";
  const ata = pod.arrivalStatus?.toLowerCase() === "actual" ? websiteTimestamp(pod.arrivalDate) : "";
  const officialVoyage = selected.voyage;
  return {
    vesselName: matched.vesselName || shipment.vesselName,
    voyage: officialVoyage,
    portOfLoading: pol.portName || shipment.portOfLoading,
    portOfDischarge: pod.portName || shipment.portOfDischarge,
    status: scheduleStatus(etd, atd, eta, ata),
    etd,
    atd,
    eta,
    ata,
    delayDays: eta ? Math.max(0, dayDifference(eta, shipment.eta)) : shipment.delayDays,
    source: "Yang Ming 全球官网船期",
    sourceUrl: YANG_MING_SCHEDULE_URL,
    lastCheckedAt: chinaTimestamp(),
    notes: `Yang Ming 官网匹配船名及有序两港${partnerVoyageNote(shipment.voyage, officialVoyage)}；${atd ? `实际开航 ${timeLabel(atd)}` : `计划开航 ${timeLabel(etd)}`}，计划到港 ${timeLabel(eta)}${detail.currentLane ? `；航线 ${detail.currentLane}` : ""}。`,
  };
}

const automaticCarrierQueryIds = new Set([
  "evergreen",
  "maersk",
  "sinotrans",
  "pancon",
  "cosco",
  "one",
  "hmm",
  "yang-ming",
]);

function supportsAutomaticCarrierQuery(carrier: Carrier) {
  return automaticCarrierQueryIds.has(carrier.id);
}

function carrierQueryKey(
  carrier: Carrier,
  shipment: TrackingShipment,
  allowVoyageAlias: boolean
) {
  return JSON.stringify([
    carrier.id,
    allowVoyageAlias,
    identifier(shipment.vesselName),
    identifier(shipment.voyage),
    identifier(shipment.portOfLoading),
    identifier(shipment.portOfDischarge),
    identifier(shipment.containerNo),
    identifier(shipment.billOfLading),
    identifier(shipment.bookingNo),
    shipment.baselineEtd || "",
    shipment.etd || "",
    shipment.atd || "",
    shipment.baselineEta || "",
    shipment.eta || "",
    shipment.ata || "",
  ]);
}

async function queryCarrierSource(
  carrier: Carrier,
  shipment: TrackingShipment,
  session: TrackingSession,
  context: CarrierQueryContext
) {
  switch (carrier.id) {
    case "evergreen":
      return queryEvergreen(shipment);
    case "maersk":
      return queryMaersk(shipment, session, context);
    case "sinotrans":
      return querySinotrans(shipment);
    case "pancon":
      return queryPancon(shipment, session);
    case "cosco":
      return queryCoscoGlobal(shipment, session, context);
    case "one":
      return queryOne(shipment, session, context);
    case "hmm":
      return queryHmm(shipment, session, context);
    case "yang-ming":
      return queryYangMing(shipment, session, context);
    default:
      throw new Error(`${carrier.shortName} 尚未开通服务器自动查询`);
  }
}

function cachedCarrierQuery(
  carrier: Carrier,
  shipment: TrackingShipment,
  session: TrackingSession,
  context: CarrierQueryContext
) {
  const key = carrierQueryKey(carrier, shipment, context.allowVoyageAlias);
  const cached = session.carrierQueries.get(key);
  if (cached) return cached;
  const request = queryCarrierSource(carrier, shipment, session, context);
  session.carrierQueries.set(key, request);
  request.catch(() => session.carrierQueries.delete(key));
  return request;
}

type TrackingFailureCategory =
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
  if (/返回 \d{3}|服务器|官网返回/i.test(reason)) {
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
}

export async function syncShipment(
  shipment: TrackingShipment,
  session = createTrackingSession()
): Promise<TrackingResult> {
  let carrier = detectCarrier(shipment);
  let onlineIdentification: OnlineCarrierIdentification | undefined;

  try {
    if (!carrier) {
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
    }
    if (!carrier) {
      return {
        ok: false,
        identified: false,
        orderNo: shipment.orderNo,
        message: "本地规则和联网搜索均未找到可信的船公司，请补充箱号、提单号或航线",
      };
    }

    const persistedQuerySource = detectQuerySourceCarrier(shipment.source);
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

    const fallback = sharedCarrierFallbackSources(carrier.id);
    const automaticFallbacks = fallback.carriers
      .filter(supportsAutomaticCarrierQuery)
      .slice(0, 2);
    const sinotransCarrier = carriers.find((item) => item.id === "sinotrans");
    // This lightweight lookup is cached for 12 hours and runs while the
    // primary source is being queried. The full Sinotrans form request only
    // starts after the primary source fails.
    const sinotransCandidatePromise =
      carrier.id !== "sinotrans" && shipment.vesselName
        ? findSinotransVessel(shipment).catch(() => undefined)
        : Promise.resolve(undefined);
    type FallbackAttempt =
      | {
          ok: true;
          sourceCarrier: Carrier;
          relationship: string;
          update: TrackingUpdate;
        }
      | {
          ok: false;
          sourceCarrier: Carrier;
          relationship: string;
          reason: string;
        };
    const createFallbackAttempt = (
      sourceCarrier: Carrier,
      relationship: string
    ): Promise<FallbackAttempt> =>
      cachedCarrierQuery(sourceCarrier, shipment, session, {
        allowVoyageAlias: true,
        primaryCarrier: carrier,
        sourceCarrier,
      })
        .then((update) => ({
          ok: true as const,
          sourceCarrier,
          relationship,
          update,
        }))
        .catch((error) => ({
          ok: false as const,
          sourceCarrier,
          relationship,
          reason: trackingErrorReason(error),
        }));
    // Start verified partner lookups immediately, but still prefer a successful
    // primary result. If the primary source fails, the fallback is usually
    // already finished instead of adding another full website wait.
    const fallbackAttempts: Array<Promise<FallbackAttempt>> =
      automaticFallbacks.map((sourceCarrier) =>
        createFallbackAttempt(
          sourceCarrier,
          fallback.relationship || "共舱合作"
        )
      );
    const attemptedFallbackCarriers = [...automaticFallbacks];

    let primaryError = "";
    if (supportsAutomaticCarrierQuery(carrier)) {
      try {
        const update = await cachedCarrierQuery(carrier, shipment, session, {
          allowVoyageAlias: false,
          sourceCarrier: carrier,
        });
        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `${update.source} 查询成功`,
          update,
        };
      } catch (error) {
        primaryError = trackingErrorReason(error);
      }
    }

    const sinotransCandidate = await sinotransCandidatePromise;
    if (
      sinotransCandidate &&
      sinotransCarrier &&
      !attemptedFallbackCarriers.some((item) => item.id === sinotransCarrier.id)
    ) {
      attemptedFallbackCarriers.unshift(sinotransCarrier);
      fallbackAttempts.unshift(
        createFallbackAttempt(
          sinotransCarrier,
          "中外运官方船名库精确匹配后的智能回退"
        )
      );
    }

    const fallbackWinnerPromise = fallbackAttempts.length
      ? Promise.any(
          fallbackAttempts.map(async (attempt) => {
            const result = await attempt;
            if (!result.ok) throw new Error(result.reason);
            return result;
          })
        ).catch(() => undefined)
      : Promise.resolve(undefined);

    const winner = await fallbackWinnerPromise;
    if (winner) {
        const partnerVoyage = winner.update.voyage;
        const relationship = winner.relationship;
        const fallbackKind =
          winner.sourceCarrier.id === "sinotrans" ? "智能回退" : "共舱回退";
        const update: TrackingUpdate = {
          ...winner.update,
          // The order keeps the customer's voyage number. The partner alias is
          // evidence for this lookup and is recorded in notes instead.
          voyage: shipment.voyage,
          source: `${winner.update.source}（${fallbackKind}）`,
          notes: `${fallbackKind}：${carrier.shortName} → ${winner.sourceCarrier.shortName}（${relationship}）${partnerVoyageNote(shipment.voyage, partnerVoyage)}。${winner.update.notes}`,
        };
        return {
          ok: true,
          orderNo: shipment.orderNo,
          message: `${carrier.shortName} 主来源未命中，已由 ${winner.sourceCarrier.shortName} ${fallbackKind}更新`,
          update,
        };
    }
    const fallbackErrors = (await Promise.all(fallbackAttempts)).flatMap(
      (result) => result.ok
        ? []
        : [`${result.sourceCarrier.shortName}：${result.reason}`]
    );

    if (!supportsAutomaticCarrierQuery(carrier)) {
      const officialUrl = carrierTrackingUrl(carrier, shipment);
      const method = onlineIdentification ? "联网识别" : "规则识别";
      const evidence = onlineIdentification
        ? `；查询依据：${onlineIdentification.evidenceTitle}`
        : "";
      const needsCredentials = carrier.queryMode === "api-credentials";
      const partnerNames = attemptedFallbackCarriers
        .map((item) => item.shortName)
        .join("、");
      const fallbackStatus = partnerNames
        ? `；已启用 ${partnerNames} 共舱回退${fallbackErrors.length ? `，但本次未命中（${fallbackErrors.join("；")}）` : "，其服务器自动查询尚未开通"}`
        : "";
      const availability = needsCredentials
        ? "官网船期入口已找到；主来源自动回填需要该船公司的 API 授权凭据"
        : "官网入口已找到，主来源船期自动回填尚未开通";
      return {
        ok: false,
        identified: true,
        orderNo: shipment.orderNo,
        message: `${method}为 ${carrier.shortName}；${availability}${fallbackStatus}`,
        identification: {
          source: `${carrier.shortName}（${method}）`,
          sourceUrl: officialUrl,
          lastCheckedAt: chinaTimestamp(),
          notes: `${method}船公司：${carrier.name}${evidence}。${availability}${fallbackStatus}。`,
        },
      };
    }

    const reason = [primaryError, ...fallbackErrors].filter(Boolean).join("；") || "查询失败";
    return {
      ok: false,
      identified: false,
      orderNo: shipment.orderNo,
      message: reason,
      check: {
        source: shipment.source || carrier.shortName,
        sourceUrl: carrierTrackingUrl(carrier, shipment),
        lastCheckedAt: chinaTimestamp(),
        notes: `本次已查询 ${carrier.shortName} 主来源${attemptedFallbackCarriers.length ? `，并回退 ${attemptedFallbackCarriers.map((item) => item.shortName).join("、")}` : ""}：${reason}。`,
      },
    };
  } catch (error) {
    const reason = trackingErrorReason(error);
    return {
      ok: false,
      identified: false,
      orderNo: shipment.orderNo,
      message: reason,
      ...(carrier
        ? {
            check: {
              source: shipment.source || carrier.shortName,
              sourceUrl: carrierTrackingUrl(carrier, shipment),
              lastCheckedAt: chinaTimestamp(),
              notes: `本次已查询 ${carrier.shortName} 官网：${reason}。`,
            },
          }
        : {}),
    };
  }
}
