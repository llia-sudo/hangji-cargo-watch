export type CarrierQueryMode = "automatic" | "official-page" | "api-credentials";

export type Carrier = {
  id: string;
  name: string;
  shortName: string;
  rank?: number;
  queryMode: CarrierQueryMode;
  trackingUrl: string;
  trackingUrlTemplate?: string;
  aliases: string[];
  containerPrefixes: string[];
  documentPrefixes: string[];
  vesselKeywords: string[];
  markets: string[];
};

export type CarrierDetectionInput = {
  source?: string;
  containerNo?: string;
  billOfLading?: string;
  bookingNo?: string;
  vesselName?: string;
  voyage?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
};

type VesselRouteAlias = {
  carrierId: string;
  vesselName: string;
  portPairs: Array<[string, string]>;
};

export type SharedCarrierFallback = {
  carrierId: string;
  sourceCarrierIds: string[];
  relationship: string;
};

export const carriers: Carrier[] = [
  {
    id: "msc",
    name: "Mediterranean Shipping Company",
    shortName: "MSC",
    rank: 1,
    queryMode: "api-credentials",
    trackingUrl: "https://www.msc.com/en/search-a-schedule",
    aliases: ["MSC", "MEDITERRANEAN SHIPPING"],
    containerPrefixes: ["MSCU", "MEDU"],
    documentPrefixes: ["MSCU", "MEDU"],
    vesselKeywords: ["MSC "],
    markets: ["阿联酋", "南美", "墨西哥", "加拿大", "委内瑞拉", "法国"],
  },
  {
    id: "maersk",
    name: "A.P. Moller – Maersk",
    shortName: "Maersk",
    rank: 2,
    queryMode: "automatic",
    trackingUrl: "https://www.maersk.com/schedules/vesselSchedules",
    trackingUrlTemplate: "https://www.maersk.com/tracking/{reference}",
    aliases: ["MAERSK", "SEALAND", "HAMBURG SUD", "ALIanca"],
    containerPrefixes: ["MSKU", "MAEU", "MRSU", "MRKU"],
    documentPrefixes: ["MAEU", "MSKU"],
    vesselKeywords: ["MAERSK "],
    markets: ["阿联酋", "南美", "墨西哥", "加拿大", "委内瑞拉", "法国"],
  },
  {
    id: "cma-cgm",
    name: "CMA CGM Group",
    shortName: "CMA CGM",
    rank: 3,
    queryMode: "api-credentials",
    trackingUrl: "https://www.cma-cgm.com/ebusiness/schedules/voyage",
    trackingUrlTemplate:
      "https://www.cma-cgm.com/ebusiness/tracking?Reference={reference}&SearchBy=Container",
    aliases: ["CMA CGM", "APL", "ANL", "CNC LINE", "MERCOSUL"],
    containerPrefixes: ["CMAU", "CGMU", "APLU", "ANLU"],
    documentPrefixes: ["CMDU", "CMAU", "APLU", "ANLU"],
    vesselKeywords: ["CMA CGM ", "APL "],
    markets: ["阿联酋", "南美", "墨西哥", "加拿大", "委内瑞拉", "法国"],
  },
  {
    id: "cosco",
    name: "COSCO SHIPPING Lines",
    shortName: "COSCO",
    rank: 4,
    queryMode: "automatic",
    trackingUrl:
      "https://elines.coscoshipping.com/ebusiness/sailingSchedule/searchByVesselName/resultByVoyage",
    trackingUrlTemplate:
      "https://elines.coscoshipping.com/ebusiness/cargotracking?trackingType=CONTAINER&number={reference}",
    aliases: [
      "COSCO",
      "COSCO SHIPPING",
      "COSCO SHIPPING KOREA",
      "SIFCO",
      "SHANGHAI INCHON INTERNATIONAL FERRY",
      "SHANGHAI INCHEON INTERNATIONAL FERRY",
    ],
    containerPrefixes: ["CCLU", "COSU", "CSNU"],
    documentPrefixes: ["COSU", "COSN", "CCLU"],
    vesselKeywords: ["COSCO "],
    markets: ["韩国", "阿联酋", "南美", "墨西哥", "加拿大", "法国"],
  },
  {
    id: "hapag-lloyd",
    name: "Hapag-Lloyd",
    shortName: "Hapag-Lloyd",
    rank: 5,
    queryMode: "api-credentials",
    trackingUrl: "https://www.hapag-lloyd.com/solutions/schedule/",
    aliases: ["HAPAG", "HAPAG-LLOYD", "UASC"],
    containerPrefixes: ["HLCU", "UACU"],
    documentPrefixes: ["HLCU", "HLCU"],
    vesselKeywords: ["HAPAG ", "UASC "],
    markets: ["阿联酋", "南美", "墨西哥", "加拿大", "委内瑞拉", "法国"],
  },
  {
    id: "one",
    name: "Ocean Network Express",
    shortName: "ONE",
    rank: 6,
    queryMode: "automatic",
    trackingUrl:
      "https://ecomm.one-line.com/one-ecom/schedule/vessel-schedule",
    aliases: ["OCEAN NETWORK EXPRESS", "ONE LINE", "ONE"],
    containerPrefixes: ["ONEU", "NYKU", "MOLU"],
    documentPrefixes: ["ONEY", "ONEU"],
    vesselKeywords: ["ONE "],
    markets: ["韩国", "阿联酋", "南美", "墨西哥", "加拿大", "法国"],
  },
  {
    id: "evergreen",
    name: "Evergreen Marine",
    shortName: "Evergreen",
    rank: 7,
    queryMode: "automatic",
    trackingUrl:
      "https://ss.shipmentlink.com/tvs2/jsp/TVS2_InteractiveSchedule.jsp",
    aliases: ["EVERGREEN", "SHIPMENTLINK", "ITALIA MARITTIMA"],
    containerPrefixes: ["EMCU", "EISU", "EGHU", "EGLV"],
    documentPrefixes: ["EGLV", "EMCU"],
    vesselKeywords: ["EVER ", "EVERGREEN "],
    markets: ["韩国", "阿联酋", "南美", "墨西哥", "加拿大", "法国"],
  },
  {
    id: "hmm",
    name: "HMM Co., Ltd.",
    shortName: "HMM",
    rank: 8,
    queryMode: "automatic",
    trackingUrl:
      "https://www.hmm21.com/e-service/general/schedule/ScheduleMain.do",
    aliases: ["HMM", "HYUNDAI MERCHANT MARINE"],
    containerPrefixes: ["HDMU", "HJCU"],
    documentPrefixes: ["HDMU", "HMMU"],
    vesselKeywords: ["HMM ", "HYUNDAI "],
    markets: ["韩国", "阿联酋", "南美", "墨西哥", "加拿大", "法国"],
  },
  {
    id: "yang-ming",
    name: "Yang Ming Marine Transport",
    shortName: "Yang Ming",
    rank: 9,
    queryMode: "automatic",
    trackingUrl:
      "https://www.yangming.com/en/esolution/schedule/vessel_schedule",
    aliases: ["YANG MING", "YANGMING"],
    containerPrefixes: ["YMLU", "YMMU"],
    documentPrefixes: ["YMLU"],
    vesselKeywords: ["YM ", "YANG MING "],
    markets: ["韩国", "阿联酋", "南美", "墨西哥", "加拿大", "法国"],
  },
  {
    id: "zim",
    name: "ZIM Integrated Shipping Services",
    shortName: "ZIM",
    rank: 10,
    queryMode: "api-credentials",
    trackingUrl: "https://www.zim.com/schedules/schedule-by-vessel",
    aliases: ["ZIM", "GOLD STAR LINE"],
    containerPrefixes: ["ZIMU", "ZCSU"],
    documentPrefixes: ["ZIMU"],
    vesselKeywords: ["ZIM "],
    markets: ["阿联酋", "南美", "墨西哥", "加拿大", "委内瑞拉", "法国"],
  },
  {
    id: "oocl",
    name: "Orient Overseas Container Line",
    shortName: "OOCL",
    queryMode: "official-page",
    trackingUrl:
      "https://www.oocl.com/eng/ourservices/eservices/trackandtrace/Pages/default.aspx?lang=eng",
    aliases: ["OOCL", "ORIENT OVERSEAS"],
    containerPrefixes: ["OOLU"],
    documentPrefixes: ["OOLU"],
    vesselKeywords: ["OOCL "],
    markets: ["韩国", "阿联酋", "南美", "墨西哥", "加拿大", "法国"],
  },
  {
    id: "pil",
    name: "Pacific International Lines",
    shortName: "PIL",
    queryMode: "official-page",
    trackingUrl:
      "https://www.pilship.com/en-our-track-and-trace-pil-pacific-international-lines/120.html",
    aliases: ["PIL", "PACIFIC INTERNATIONAL LINES"],
    containerPrefixes: ["PILU", "PCIU"],
    documentPrefixes: ["PILU", "PCIU"],
    vesselKeywords: ["KOTA "],
    markets: ["阿联酋", "南美", "墨西哥"],
  },
  {
    id: "wan-hai",
    name: "Wan Hai Lines",
    shortName: "Wan Hai",
    queryMode: "official-page",
    trackingUrl: "https://www.wanhai.com/views/cargoTrack/CargoTrack.xhtml",
    aliases: ["WAN HAI", "WANHAI"],
    containerPrefixes: ["WHLU"],
    documentPrefixes: ["WHLU"],
    vesselKeywords: ["WAN HAI "],
    markets: ["韩国", "阿联酋", "墨西哥"],
  },
  {
    id: "sitc",
    name: "SITC Container Lines",
    shortName: "SITC",
    queryMode: "official-page",
    trackingUrl: "https://www.sitc.com/track",
    aliases: ["SITC"],
    containerPrefixes: ["SITU"],
    documentPrefixes: ["SITU", "SITG"],
    vesselKeywords: ["SITC "],
    markets: ["韩国", "阿联酋"],
  },
  {
    id: "kmtc",
    name: "Korea Marine Transport Co.",
    shortName: "KMTC",
    queryMode: "official-page",
    trackingUrl: "https://www.ekmtc.com/index.html#/cargo-tracking",
    aliases: ["KMTC", "KOREA MARINE TRANSPORT"],
    containerPrefixes: ["KMTU"],
    documentPrefixes: ["KMTU"],
    vesselKeywords: ["KMTC "],
    markets: ["韩国", "阿联酋"],
  },
  {
    id: "sinokor",
    name: "Sinokor Merchant Marine",
    shortName: "Sinokor",
    queryMode: "official-page",
    trackingUrl: "https://e-sinokor.com/Schedule/vsl-schedule",
    aliases: ["SINOKOR"],
    containerPrefixes: ["SKLU"],
    documentPrefixes: ["SKLU", "SNKO"],
    vesselKeywords: ["SINOKOR "],
    markets: ["韩国"],
  },
  {
    id: "sinotrans",
    name: "Sinotrans Container Lines Co., Ltd.",
    shortName: "中外运集运",
    queryMode: "automatic",
    trackingUrl:
      "https://ebusiness.sinolines.com.cn/Ebusiness/EQUERY/QuerySchedule.aspx",
    aliases: [
      "SINOTRANS CONTAINER LINES",
      "SINOLINES",
      "中外运集运",
      "外运集运",
    ],
    containerPrefixes: ["SNLU"],
    documentPrefixes: [],
    vesselKeywords: ["SINOTRANS "],
    markets: ["韩国", "墨西哥", "南美"],
  },
  {
    id: "pancon",
    name: "Pan Continental Shipping",
    shortName: "PANCON",
    queryMode: "automatic",
    trackingUrl:
      "https://www.pancon.co.kr/pan/pageLink.pcl?link=COM%2FWEB_211",
    aliases: ["PANCON", "PAN CONTINENTAL"],
    containerPrefixes: ["PCLU"],
    documentPrefixes: ["PCLU"],
    vesselKeywords: ["PANCON "],
    markets: ["韩国"],
  },
  {
    id: "heung-a",
    name: "Heung-A Line",
    shortName: "Heung-A",
    queryMode: "official-page",
    trackingUrl: "https://ebiz.heung-a.com/",
    aliases: ["HEUNG-A", "HEUNG A"],
    containerPrefixes: ["HALU"],
    documentPrefixes: ["HALU"],
    vesselKeywords: ["HEUNG-A "],
    markets: ["韩国"],
  },
  {
    id: "sm-line",
    name: "SM Line Corporation",
    shortName: "SM Line",
    queryMode: "official-page",
    trackingUrl: "https://esvc.smlines.com/smline/CUP_HOM_3301.do",
    aliases: ["SM LINE", "SMLINE"],
    containerPrefixes: ["SMLU"],
    documentPrefixes: ["SMLU", "SMLM"],
    vesselKeywords: ["SM LINE "],
    markets: ["韩国", "加拿大", "墨西哥"],
  },
  {
    id: "emirates-line",
    name: "Emirates Shipping Line",
    shortName: "Emirates Line",
    queryMode: "official-page",
    trackingUrl: "https://www.emiratesline.com/track-shipment",
    aliases: ["EMIRATES SHIPPING", "EMIRATES LINE"],
    containerPrefixes: ["ESPU"],
    documentPrefixes: ["ESPU", "ESLS"],
    vesselKeywords: ["EMIRATES "],
    markets: ["阿联酋"],
  },
  {
    id: "namsung",
    name: "Namsung Shipping",
    shortName: "Namsung",
    queryMode: "official-page",
    trackingUrl: "https://ebiz.namsung.co.kr/",
    aliases: ["NAMSUNG"],
    containerPrefixes: ["NSRU"],
    documentPrefixes: ["NSRU"],
    vesselKeywords: ["NAMSUNG "],
    markets: ["韩国"],
  },
  {
    id: "rcl",
    name: "Regional Container Lines",
    shortName: "RCL",
    queryMode: "official-page",
    trackingUrl: "https://www.rclgroup.com/track-trace/",
    aliases: ["RCL", "REGIONAL CONTAINER LINES"],
    containerPrefixes: ["RCLU"],
    documentPrefixes: ["RCLU"],
    vesselKeywords: ["RCL "],
    markets: ["阿联酋"],
  },
];

export const topTenCarriers = carriers.filter((carrier) => carrier.rank);
export const regionalCarriers = carriers.filter((carrier) => !carrier.rank);

// These are query-source relationships, not permanent vessel ownership.
// Results from a partner source still have to match the physical vessel,
// ordered POL/POD calls and the shipment's schedule window before use.
export const sharedCarrierFallbacks: SharedCarrierFallback[] = [
  {
    carrierId: "zim",
    sourceCarrierIds: ["msc"],
    relationship: "ZIM / MSC 共舱与舱位互换",
  },
  {
    carrierId: "msc",
    sourceCarrierIds: ["zim"],
    relationship: "MSC / ZIM 共舱与舱位互换",
  },
  {
    carrierId: "hapag-lloyd",
    sourceCarrierIds: ["maersk"],
    relationship: "Gemini Cooperation",
  },
  {
    carrierId: "maersk",
    sourceCarrierIds: ["hapag-lloyd"],
    relationship: "Gemini Cooperation",
  },
  {
    carrierId: "cma-cgm",
    sourceCarrierIds: ["cosco"],
    relationship: "Ocean Alliance 共舱",
  },
  {
    carrierId: "evergreen",
    sourceCarrierIds: ["cosco"],
    relationship: "Ocean Alliance 共舱",
  },
  {
    carrierId: "oocl",
    sourceCarrierIds: ["cosco"],
    relationship: "Ocean Alliance / COSCO 集团船期",
  },
  {
    carrierId: "one",
    sourceCarrierIds: ["hmm", "yang-ming"],
    relationship: "Premier Alliance 共舱",
  },
  {
    carrierId: "hmm",
    sourceCarrierIds: ["one", "yang-ming"],
    relationship: "Premier Alliance 共舱",
  },
  {
    carrierId: "yang-ming",
    sourceCarrierIds: ["one", "hmm"],
    relationship: "Premier Alliance 共舱",
  },
];

export function sharedCarrierFallbackSources(carrierId: string) {
  const rule = sharedCarrierFallbacks.find(
    (item) => item.carrierId === carrierId
  );
  return {
    relationship: rule?.relationship ?? "",
    carriers: (rule?.sourceCarrierIds ?? [])
      .map((sourceId) => carriers.find((carrier) => carrier.id === sourceId))
      .filter((carrier): carrier is Carrier => Boolean(carrier)),
  };
}

// A vessel can be chartered by different carriers over its lifetime. Keep
// vessel-only aliases scoped to the route where the commercial operator has
// been verified instead of permanently assigning the vessel to one company.
const vesselRouteAliases: VesselRouteAlias[] = [
  {
    carrierId: "cosco",
    vesselName: "CONCERTO",
    portPairs: [
      ["SHANGHAI", "INCHEON"],
      ["INCHEON", "SHANGHAI"],
    ],
  },
  {
    carrierId: "sinotrans",
    vesselName: "REN JIAN 27",
    portPairs: [["SHANGHAI", "MANZANILLO"]],
  },
];

function normalize(value?: string) {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
}

function compact(value?: string) {
  return normalize(value).replaceAll(" ", "");
}

function normalizePort(value?: string) {
  const port = normalize(value);
  if (port === "INCHON") return "INCHEON";
  if (port === "PUSAN") return "BUSAN";
  return port;
}

function startsWithAny(value: string, prefixes: string[]) {
  return prefixes.some((prefix) => value.startsWith(compact(prefix)));
}

export function detectCarrier(input: CarrierDetectionInput) {
  const source = normalize(input.source);
  const container = compact(input.containerNo);
  const document = compact(input.billOfLading || input.bookingNo);
  const vessel = normalize(input.vesselName);
  const vesselWithBoundaries = ` ${vessel} `;
  const pol = normalizePort(input.portOfLoading);
  const pod = normalizePort(input.portOfDischarge);

  if (source && !["手工录入", "EXCEL导入", "自动识别"].includes(source)) {
    const explicit = carriers.find((carrier) =>
      carrier.aliases.some((alias) => source.includes(normalize(alias)))
    );
    if (explicit) return explicit;
  }

  if (container) {
    const byContainer = carriers.find((carrier) =>
      startsWithAny(container, carrier.containerPrefixes)
    );
    if (byContainer) return byContainer;
  }

  if (document) {
    const byDocument = carriers.find((carrier) =>
      startsWithAny(document, carrier.documentPrefixes)
    );
    if (byDocument) return byDocument;
  }

  if (vessel && pol && pod) {
    const routeAlias = vesselRouteAliases.find(
      (rule) =>
        vessel === normalize(rule.vesselName) &&
        rule.portPairs.some(
          ([from, to]) =>
            pol === normalizePort(from) && pod === normalizePort(to)
        )
    );
    if (routeAlias) {
      return carriers.find((carrier) => carrier.id === routeAlias.carrierId);
    }
  }

  if (vessel) {
    return carriers.find((carrier) =>
      carrier.vesselKeywords.some((keyword) =>
        vesselWithBoundaries.includes(` ${normalize(keyword)} `)
      )
    );
  }

  return undefined;
}

export function carrierTrackingUrl(
  carrier: Carrier,
  input: CarrierDetectionInput
) {
  const reference = compact(
    input.containerNo || input.billOfLading || input.bookingNo
  );
  if (!reference || !carrier.trackingUrlTemplate) return carrier.trackingUrl;
  return carrier.trackingUrlTemplate.replace(
    "{reference}",
    encodeURIComponent(reference)
  );
}
