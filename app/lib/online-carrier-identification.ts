import {
  Carrier,
  CarrierDetectionInput,
  carriers,
} from "@/app/lib/carriers";

export type OnlineCarrierIdentification = {
  carrier: Carrier;
  evidenceTitle: string;
  evidenceUrl: string;
  confidence: "high" | "medium";
};

type SearchItem = {
  title: string;
  description: string;
  link: string;
  provider: "brave" | "duckduckgo";
};

const BRAVE_SEARCH_URL = "https://search.brave.com/search";
const DUCKDUCKGO_SEARCH_URL = "https://html.duckduckgo.com/html/";
const DISCOVERY_BUDGET_MS = 8_000;
const SEARCH_TIMEOUT_MS = 5_500;
const officialDomainOverrides: Record<string, string[]> = {
  cosco: ["coscoshipping.com", "coscokorea.com"],
  evergreen: ["shipmentlink.com", "evergreen-marine.com"],
  pancon: ["pancon.co.kr"],
  one: ["one-line.com"],
  kmtc: ["ekmtc.com"],
  "lyg-ferry": ["lygferry.com"],
};

function normalize(value?: string) {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value?: string) {
  return normalize(value).replaceAll(" ", "");
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanHtml(value: string) {
  return decodeXml(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBraveResults(html: string): SearchItem[] {
  return html
    .split(/<div class="snippet [^"]*" data-pos="\d+"/i)
    .slice(1)
    .map((block) => {
      const link = block.match(
        /data-type="web"[\s\S]*?<a href="(https?:\/\/[^"#]+)"/i
      )?.[1];
      const title = block.match(
        /class="title search-snippet-title[^"]*" title="([^"]+)"/i
      )?.[1];
      const description = block.match(
        /class="content desktop-default-regular[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      )?.[1];
      return {
        title: cleanHtml(title ?? ""),
        description: cleanHtml(description ?? ""),
        link: decodeXml(link ?? ""),
        provider: "brave" as const,
      };
    })
    .filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

function decodeDuckDuckGoLink(value: string) {
  const decoded = decodeXml(value);
  try {
    const url = new URL(decoded, DUCKDUCKGO_SEARCH_URL);
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return decoded;
  }
}

function parseDuckDuckGoResults(html: string): SearchItem[] {
  return html
    .split(/class="result results_links[^\"]*"/i)
    .slice(1)
    .map((block) => {
      const anchor = block.match(
        /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
      );
      const description = block.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i
      );
      return {
        title: cleanHtml(anchor?.[2] ?? ""),
        description: cleanHtml(description?.[1] ?? description?.[2] ?? ""),
        link: decodeDuckDuckGoLink(anchor?.[1] ?? ""),
        provider: "duckduckgo" as const,
      };
    })
    .filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

function fetchWithTimeout(url: string, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 CargoWatch/1.0",
    },
  }).finally(() => clearTimeout(timer));
}

async function searchBrave(query: string) {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("source", "web");
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) throw new Error(`Brave 联网搜索返回 ${response.status}`);
  return parseBraveResults(await response.text());
}

async function searchDuckDuckGo(query: string) {
  const url = new URL(DUCKDUCKGO_SEARCH_URL);
  url.searchParams.set("q", query);
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`DuckDuckGo 联网搜索返回 ${response.status}`);
  }
  return parseDuckDuckGoResults(await response.text());
}

async function searchAcrossProviders(query: string) {
  const responses = await Promise.allSettled([
    searchBrave(query),
    searchDuckDuckGo(query),
  ]);
  return responses.flatMap((response) =>
    response.status === "fulfilled" ? response.value : []
  );
}

function officialDomains(carrier: Carrier) {
  const derived = new URL(carrier.trackingUrl).hostname.replace(/^www\./, "");
  return [...new Set([derived, ...(officialDomainOverrides[carrier.id] ?? [])])];
}

function containsPhrase(text: string, phrase: string) {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function scoreItem(
  item: SearchItem,
  carrier: Carrier,
  input: CarrierDetectionInput
) {
  const text = normalize(`${item.title} ${item.description}`);
  const compactText = compact(text);
  const vessel = normalize(input.vesselName);
  const voyage = compact(input.voyage);
  const pol = normalize(input.portOfLoading);
  const pod = normalize(input.portOfDischarge);
  const document = compact(input.billOfLading || input.bookingNo);
  const documentPrefix = document.slice(0, 4);
  const vesselMatched = Boolean(vessel && text.includes(vessel));
  if (!vesselMatched) return { score: 0, official: false, alias: false };

  let host = "";
  try {
    host = new URL(item.link).hostname.replace(/^www\./, "");
  } catch {
    return { score: 0, official: false, alias: false };
  }

  const official = officialDomains(carrier).some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
  const strongAliases = carrier.aliases.filter(
    (alias) => compact(alias).length >= 4
  );
  const shortAliases = carrier.aliases.filter(
    (alias) => compact(alias).length < 4
  );
  const strongAliasMatched = strongAliases.some((alias) =>
    containsPhrase(text, alias)
  );
  const shortAliasMatched = shortAliases.some((alias) =>
    containsPhrase(text, alias)
  );
  const alias = strongAliasMatched || shortAliasMatched;

  let score = 5;
  if (voyage && compactText.includes(voyage)) score += 3;
  if (pol && text.includes(pol)) score += 1;
  if (pod && text.includes(pod)) score += 1;
  if (documentPrefix && compactText.includes(documentPrefix)) score += 2;
  if (official) score += 7;
  if (strongAliasMatched) score += 4;
  else if (shortAliasMatched) score += 2;

  return { score, official, alias };
}

function buildQueries(input: CarrierDetectionInput) {
  const vessel = normalize(input.vesselName);
  const voyage = normalize(input.voyage);
  const pol = normalize(input.portOfLoading);
  const pod = normalize(input.portOfDischarge);
  const document = compact(input.billOfLading || input.bookingNo);
  const documentPrefix = document.slice(0, 4);
  const exactVessel = vessel ? `"${vessel}"` : "";
  const exactVoyage = voyage ? `"${voyage}"` : "";
  const exactDocumentPrefix = documentPrefix ? `"${documentPrefix}"` : "";
  return [
    [exactVessel, exactVoyage, pol, pod, "shipping line vessel schedule operator"],
    [exactVessel, pol, pod, "operator carrier ferry shipping"],
    [exactDocumentPrefix, "bill of lading prefix shipping line carrier"],
    [exactVessel, exactVoyage, "official schedule"],
  ]
    .map((parts) => parts.filter(Boolean).join(" "))
    .filter((query, index, all) => query && all.indexOf(query) === index);
}

function isSearchOrAggregatorHost(host: string) {
  return [
    "search.brave.com",
    "duckduckgo.com",
    "google.com",
    "bing.com",
    "vesselfinder.com",
    "marinetraffic.com",
    "myshiptracking.com",
  ].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function unknownEvidenceScore(item: SearchItem, input: CarrierDetectionInput) {
  const text = normalize(`${item.title} ${item.description}`);
  const compactText = compact(text);
  const vessel = normalize(input.vesselName);
  const voyage = compact(input.voyage);
  const pol = normalize(input.portOfLoading);
  const pod = normalize(input.portOfDischarge);
  const document = compact(input.billOfLading || input.bookingNo);
  const documentPrefix = document.slice(0, 4);
  if (!vessel || !text.includes(vessel)) return 0;
  let score = 5;
  if (voyage && compactText.includes(voyage)) score += 3;
  if (pol && text.includes(pol)) score += 2;
  if (pod && text.includes(pod)) score += 2;
  if (documentPrefix && compactText.includes(documentPrefix)) score += 2;
  return score;
}

function siteBrand(item: SearchItem) {
  try {
    const host = new URL(item.link).hostname.replace(/^www\./, "");
    const firstTitlePart = item.title.split(/\s[-|·:]\s/)[0]?.trim();
    if (firstTitlePart && firstTitlePart.length <= 60) return firstTitlePart;
    return host.split(".").slice(-2, -1)[0]?.toUpperCase() || host;
  } catch {
    return item.title.slice(0, 60) || "未知船司候选";
  }
}

function discoverUnknownCarrierCandidate(
  items: SearchItem[],
  input: CarrierDetectionInput
): OnlineCarrierIdentification | undefined {
  const ranked = items
    .map((item) => {
      let host = "";
      try {
        host = new URL(item.link).hostname.replace(/^www\./, "");
      } catch {
        return { item, host: "", score: 0 };
      }
      return {
        item,
        host,
        score: isSearchOrAggregatorHost(host)
          ? 0
          : unknownEvidenceScore(item, input),
      };
    })
    .filter((candidate) => candidate.score >= 7)
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) return undefined;

  const corroboratingHosts = new Set(
    ranked
      .filter((candidate) => candidate.host === best.host)
      .map((candidate) => candidate.item.provider)
  );
  const confidence =
    best.score >= 10 || corroboratingHosts.size >= 2 ? "high" : "medium";
  const brand = siteBrand(best.item);
  const dynamicCarrier: Carrier = {
    id: `discovered-${best.host.replace(/[^a-z0-9]+/gi, "-")}`,
    name: `${brand}（联网发现候选）`,
    shortName: brand,
    queryMode: "official-page",
    trackingUrl: best.item.link,
    aliases: [brand],
    containerPrefixes: [],
    documentPrefixes: [],
    vesselKeywords: [],
    markets: [],
  };
  return {
    carrier: dynamicCarrier,
    evidenceTitle: `第三层未知船司发现：${best.item.title}`,
    evidenceUrl: best.item.link,
    confidence,
  };
}

async function identifyWithinBudget(
  input: CarrierDetectionInput
): Promise<OnlineCarrierIdentification | undefined> {
  const queries = buildQueries(input);
  const responses = await Promise.allSettled(
    queries.map((query) => searchAcrossProviders(query))
  );
  const items = responses.flatMap((response) =>
    response.status === "fulfilled" ? response.value : []
  );
  const unique = Array.from(
    new Map(items.map((item) => [`${item.link}|${item.title}`, item])).values()
  );
  if (!unique.length) return undefined;

  const candidates = carriers.flatMap((carrier) =>
    unique.map((item) => ({ carrier, item, ...scoreItem(item, carrier, input) }))
  );
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (best && best.score >= 9 && (best.official || best.alias)) {
    return {
      carrier: best.carrier,
      evidenceTitle: best.item.title,
      evidenceUrl: best.item.link,
      confidence: best.official && best.score >= 12 ? "high" : "medium",
    };
  }

  return discoverUnknownCarrierCandidate(unique, input);
}

export async function identifyCarrierOnline(
  input: CarrierDetectionInput
): Promise<OnlineCarrierIdentification | undefined> {
  if (!normalize(input.vesselName)) return undefined;
  return Promise.race([
    identifyWithinBudget(input),
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), DISCOVERY_BUDGET_MS)
    ),
  ]);
}
