export const LIANYUNGANG_PLANNED_URL =
  "https://www.lygedi.com/SailingDate.html";
export const LIANYUNGANG_ACTUAL_URL =
  "https://www.lygedi.com/Sailing_ActDate.html";

export type LianyungangErrorCode =
  | "PORT_SOURCE_UNAVAILABLE"
  | "VESSEL_NOT_FOUND"
  | "VOYAGE_NOT_FOUND"
  | "TIMEOUT"
  | "NETWORK_ERROR";

export class LianyungangSourceError extends Error {
  readonly code: LianyungangErrorCode;

  constructor(
    code: LianyungangErrorCode,
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = "LianyungangSourceError";
  }
}

export type LianyungangDepartureResult = {
  departure: string;
  source: string;
  sourceUrl: string;
};

export type LianyungangSession = {
  forms: Map<string, Promise<string>>;
  queries: Map<string, Promise<LianyungangDepartureResult>>;
};

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 CargoWatch/1.0";

export function createLianyungangSession(): LianyungangSession {
  return { forms: new Map(), queries: new Map() };
}

function identity(value?: string) {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function decodeHtml(value: string) {
  return value
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
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlAttribute(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function parseRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (row) =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
        (cell) => htmlToText(cell[1])
      )
  );
}

function compositeMatches(value: string, wanted: string) {
  const key = identity(wanted);
  return Boolean(
    key &&
      value
        .split(/[\/|｜]/)
        .some((part) => identity(part) === key)
  );
}

function parseTimestamp(value: string) {
  const match = value.match(
    /(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})(?:\s*([0-2]\d):?(\d{2}))?/
  );
  if (!match) return "";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return match[4] && match[5] ? `${date} ${match[4]}:${match[5]}` : date;
}

function findDeparture(
  html: string,
  vesselName: string,
  voyage: string,
  columns: { minimum: number; vessel: number; voyage: number; departure: number }
) {
  const vesselRows = parseRows(html).filter(
    (row) =>
      row.length >= columns.minimum &&
      compositeMatches(row[columns.vessel] ?? "", vesselName)
  );
  if (!vesselRows.length) {
    throw new LianyungangSourceError(
      "VESSEL_NOT_FOUND",
      `连云港电子口岸没有找到英文船名 ${vesselName}`
    );
  }
  const matched = vesselRows.find((row) =>
    compositeMatches(row[columns.voyage] ?? "", voyage)
  );
  if (!matched) {
    throw new LianyungangSourceError(
      "VOYAGE_NOT_FOUND",
      `连云港电子口岸找到船名，但没有航次 ${voyage}`
    );
  }
  const departure = parseTimestamp(matched[columns.departure] ?? "");
  if (!departure) {
    throw new LianyungangSourceError(
      "PORT_SOURCE_UNAVAILABLE",
      "连云港电子口岸匹配记录没有可用的离港时间"
    );
  }
  return departure;
}

export function parseLianyungangPlannedDeparture(
  html: string,
  vesselName: string,
  voyage: string
) {
  return findDeparture(html, vesselName, voyage, {
    minimum: 10,
    vessel: 2,
    voyage: 3,
    departure: 5,
  });
}

export function parseLianyungangActualDeparture(
  html: string,
  vesselName: string,
  voyage: string
) {
  return findDeparture(html, vesselName, voyage, {
    minimum: 11,
    vessel: 2,
    voyage: 4,
    departure: 5,
  });
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new LianyungangSourceError("TIMEOUT", "连云港电子口岸响应超时");
    }
    throw new LianyungangSourceError(
      "NETWORK_ERROR",
      `连云港电子口岸网络错误：${error instanceof Error ? error.message : "未知错误"}`
    );
  } finally {
    clearTimeout(timer);
  }
}

async function loadForm(
  url: string,
  session: LianyungangSession,
  fetchImpl: FetchLike
) {
  const cached = session.forms.get(url);
  if (cached) return cached;
  const request = (async () => {
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      await response.text();
      throw new LianyungangSourceError(
        "PORT_SOURCE_UNAVAILABLE",
        `连云港电子口岸返回 ${response.status}`
      );
    }
    return response.text();
  })();
  session.forms.set(url, request);
  request.catch(() => session.forms.delete(url));
  return request;
}

function formBody(html: string) {
  const form = html.match(/<form\b[^>]*name=["']Form1["'][\s\S]*?<\/form>/i)?.[0];
  if (!form) {
    throw new LianyungangSourceError(
      "PORT_SOURCE_UNAVAILABLE",
      "连云港电子口岸查询表单结构已变化"
    );
  }
  const body = new URLSearchParams();
  for (const match of form.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (htmlAttribute(tag, "type").toLowerCase() !== "hidden") continue;
    const name = htmlAttribute(tag, "name");
    if (name) body.append(name, htmlAttribute(tag, "value"));
  }
  return body;
}

async function postForm(
  url: string,
  body: URLSearchParams,
  fetchImpl: FetchLike
) {
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: url,
      "User-Agent": USER_AGENT,
    },
    body,
  });
  if (!response.ok) {
    await response.text();
    throw new LianyungangSourceError(
      "PORT_SOURCE_UNAVAILABLE",
      `连云港电子口岸返回 ${response.status}`
    );
  }
  return response.text();
}

function cachedQuery(
  key: string,
  session: LianyungangSession,
  query: () => Promise<LianyungangDepartureResult>
) {
  const cached = session.queries.get(key);
  if (cached) return cached;
  const request = query();
  session.queries.set(key, request);
  request.catch(() => session.queries.delete(key));
  return request;
}

export function queryLianyungangPlannedDeparture(
  input: { vesselName: string; voyage: string },
  session: LianyungangSession,
  fetchImpl: FetchLike = fetch
) {
  const key = `planned:${identity(input.vesselName)}:${identity(input.voyage)}`;
  return cachedQuery(key, session, async () => {
    if (!identity(input.vesselName) || !identity(input.voyage)) {
      throw new LianyungangSourceError(
        "VESSEL_NOT_FOUND",
        "连云港电子口岸查询缺少英文船名或航次"
      );
    }
    const body = formBody(
      await loadForm(LIANYUNGANG_PLANNED_URL, session, fetchImpl)
    );
    body.set("propertySelection2", "-1");
    body.set("$TextField", "");
    body.set("$TextField$0", "");
    body.set("$TextField$1", input.vesselName.trim());
    body.set("$ValidDatePicker", "");
    body.set("$ValidDatePicker$0", "");
    body.set("propertySelection1", "");
    body.set("_linkSubmit", "$LinkSubmit$1");
    const html = await postForm(LIANYUNGANG_PLANNED_URL, body, fetchImpl);
    return {
      departure: parseLianyungangPlannedDeparture(
        html,
        input.vesselName,
        input.voyage
      ),
      source: "连云港电子口岸船期信息",
      sourceUrl: LIANYUNGANG_PLANNED_URL,
    };
  });
}

export function queryLianyungangActualDeparture(
  input: { vesselName: string; voyage: string },
  session: LianyungangSession,
  fetchImpl: FetchLike = fetch
) {
  const key = `actual:${identity(input.vesselName)}:${identity(input.voyage)}`;
  return cachedQuery(key, session, async () => {
    if (!identity(input.vesselName) || !identity(input.voyage)) {
      throw new LianyungangSourceError(
        "VESSEL_NOT_FOUND",
        "连云港电子口岸查询缺少英文船名或航次"
      );
    }
    const body = formBody(
      await loadForm(LIANYUNGANG_ACTUAL_URL, session, fetchImpl)
    );
    body.set("textField2", input.vesselName.trim());
    body.set("$Submit", "查询");
    const html = await postForm(LIANYUNGANG_ACTUAL_URL, body, fetchImpl);
    return {
      departure: parseLianyungangActualDeparture(
        html,
        input.vesselName,
        input.voyage
      ),
      source: "连云港电子口岸实际开航日",
      sourceUrl: LIANYUNGANG_ACTUAL_URL,
    };
  });
}
