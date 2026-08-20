export type ScheduleFields = {
  etd: string;
  atd: string;
  eta: string;
  ata: string;
};

export function isLianyungangPort(value?: string) {
  return (value ?? "").trim().toUpperCase() === "LIANYUNGANG";
}

export function mergeLianyungangFields(input: {
  plannedEtd?: string;
  actualAtd?: string;
  carrier?: Partial<ScheduleFields>;
}): ScheduleFields {
  return {
    etd: input.plannedEtd ?? "",
    atd: input.actualAtd ?? "",
    eta: input.carrier?.eta ?? "",
    ata: input.carrier?.ata ?? "",
  };
}

export function lianyungangScheduleStatus(
  fields: ScheduleFields,
  now: string
) {
  if (fields.ata) return "已到港";
  if (fields.atd) {
    return fields.eta && fields.eta < now ? "可能延期" : "运输中";
  }
  if (fields.etd) {
    return fields.etd >= now ? "待开船" : "运输中";
  }
  if (fields.eta) return fields.eta >= now ? "运输中" : "可能延期";
  return "待查询";
}

export function hasPartialScheduleSuccess(input: {
  portSucceeded: boolean;
  carrierSucceeded: boolean;
}) {
  return input.portSucceeded || input.carrierSucceeded;
}

export function routeShipmentQuery<TResult>(
  portOfLoading: string,
  queries: { lianyungang: () => TResult; carrier: () => TResult }
) {
  return isLianyungangPort(portOfLoading)
    ? queries.lianyungang()
    : queries.carrier();
}

export async function settleLianyungangSources<TPlanned, TActual, TCarrier>(
  sources: {
    planned: () => Promise<TPlanned>;
    actual: () => Promise<TActual>;
    carrier: () => Promise<TCarrier>;
  }
) {
  const [planned, actual, carrier] = await Promise.allSettled([
    sources.planned(),
    sources.actual(),
    sources.carrier(),
  ]);
  return { planned, actual, carrier };
}

export async function discoverAndDispatchCarrier<TCarrier, TResult>(input: {
  layers: Array<() => TCarrier | undefined | Promise<TCarrier | undefined>>;
  dispatch: (carrier: TCarrier, layer: 1 | 2 | 3) => Promise<TResult>;
}) {
  for (let index = 0; index < input.layers.length; index += 1) {
    const carrier = await input.layers[index]();
    if (carrier === undefined) continue;
    const layer = (index + 1) as 1 | 2 | 3;
    return {
      carrier,
      layer,
      result: await input.dispatch(carrier, layer),
    };
  }
  return undefined;
}
