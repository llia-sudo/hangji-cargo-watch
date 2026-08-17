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
};

const BRAVE_SEARCH_URL = "https://search.brave.com/search";
const officialDomainOverrides: Record<string, string[]> = {
  cosco: ["coscoshipping.com", "coscokorea.com"],
  evergreen: ["shipmentlink.com", "evergreen-marine.com"],
  pancon: ["pancon.co.kr"],
  one: ["one-line.com"],
  kmtc: ["ekmtc.com"],
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
      };
    })
    .filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

function fetchWithTimeout(url: string, timeoutMs = 7_000) {
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

async function searchWeb(query: string) {
  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("source", "web");
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) throw new Error(`联网搜索返回 ${response.status}`);
  return parseBraveResults(await response.text());
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
  const strongAliases = carrier.aliases.filter((alias) => compact(alias).length >= 4);
  const shortAliases = carrier.aliases.filter((alias) => compact(alias).length < 4);
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
  const exactVessel = vessel ? `"${vessel}"` : "";
  const exactVoyage = voyage ? `"${voyage}"` : "";
  return [
    [
      exactVessel,
      exactVoyage,
      pol,
      pod,
      "shipping line vessel schedule operator",
    ]
      .filter(Boolean)
      .join(" "),
  ].filter((query, index, all) => query && all.indexOf(query) === index);
}

export async function identifyCarrierOnline(
  input: CarrierDetectionInput
): Promise<OnlineCarrierIdentification | undefined> {
  if (!normalize(input.vesselName)) return undefined;

  const responses = await Promise.allSettled(
    buildQueries(input).map((query) => searchWeb(query))
  );
  const items = responses.flatMap((response) =>
    response.status === "fulfilled" ? response.value : []
  );
  if (!items.length) return undefined;

  const candidates = carriers.flatMap((carrier) =>
    items.map((item) => ({ carrier, item, ...scoreItem(item, carrier, input) }))
  );
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];

  // The result must name the vessel and either come from the carrier's official
  // domain or explicitly name one of that carrier's brands. This prevents a
  // loose search result from silently assigning the wrong line.
  if (!best || best.score < 9 || (!best.official && !best.alias)) {
    return undefined;
  }

  return {
    carrier: best.carrier,
    evidenceTitle: best.item.title,
    evidenceUrl: best.item.link,
    confidence: best.official && best.score >= 12 ? "high" : "medium",
  };
}
