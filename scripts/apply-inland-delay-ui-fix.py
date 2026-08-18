from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Guard failed: expected block not found in {path}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


tracking = "app/lib/tracking.ts"
dashboard = "app/TrackerApp.tsx"
tests = "tests/cargo-watch.test.mjs"

replace_once(
    tracking,
    '''  const allowOoclInlandContinuation = Boolean(
    context?.allowVoyageAlias &&
      context.primaryCarrier?.id === "oocl" &&
      exactGroup &&
      exactPol &&
      !exactGroupHasRoute
  );
  const voyageRows = exactGroupHasRoute || allowOoclInlandContinuation
    ? exactGroup
    : aliasGroups[0]?.group;''',
    '''  // If the exact vessel/voyage and POL are confirmed but the requested POD
  // is not in the downstream ocean rotation, keep reliable departure data.
  // This covers inland destinations such as Montreal after an ocean discharge
  // at Vancouver without pretending that the vessel itself calls Montreal.
  const allowDepartureOnly = Boolean(
    exactGroup &&
      exactPol &&
      !exactGroupHasRoute
  );
  const voyageRows = exactGroupHasRoute || allowDepartureOnly
    ? exactGroup
    : aliasGroups[0]?.group;''',
)

replace_once(
    tracking,
    '''  if (!pair && !allowOoclInlandContinuation) {
    throw new Error("COSCO 官网航次存在，但启运港或目的港不在同一有序港序中");
  }''',
    '''  if (!pair && !allowDepartureOnly) {
    throw new Error("COSCO 官网航次存在，但启运港或目的港不在同一有序港序中");
  }''',
)

replace_once(
    tracking,
    '''  const inlandNote = allowOoclInlandContinuation
    ? `；${shipment.portOfDischarge} 为内陆目的地，远洋挂港表不直接列出该地点，本次先更新海运干线开航信息`
    : "";''',
    '''  const inlandNote = allowDepartureOnly
    ? `；目的港信息不符：官网已确认 ${shipment.vesselName} / ${shipment.voyage} 及起运港 ${pol.protName || shipment.portOfLoading}，但 ${shipment.portOfDischarge} 不在该航次起运港后的海运挂港序中；本次仅以官网更新 ETD/ATD，ETA/ATA 未由该海运挂港表验证，目的地可能包含后续铁路、卡车或其他内陆运输`
    : "";''',
)

replace_once(
    tracking,
    '''    portOfDischarge: pod?.protName || shipment.portOfDischarge,''',
    '''    portOfDischarge: pair
      ? pod?.protName || shipment.portOfDischarge
      : shipment.portOfDischarge,''',
)

replace_once(
    tracking,
    '''  // Only completely unknown vessels fan out. Each candidate has to pass its
  // existing strict vessel + voyage + ordered POL/POD query. A vessel merely
  // appearing in one company's vessel list is not enough to claim the order.''',
    '''  // Only completely unknown vessels fan out. A source must confirm the
  // vessel and voyage, and normally an ordered POL/POD pair. If the exact
  // sailing confirms the POL but the requested POD is not in the ocean port
  // rotation, COSCO may return departure-only data with an explicit warning.''',
)

replace_once(
    tracking,
    '''            notes: `优先使用同船名同航线历史成功来源 ${learnedQuerySource.shortName}；本次仍严格匹配船名、航次及有序两港。${learnedUpdate.notes}`,''',
    '''            notes: `优先使用同船名同航线历史成功来源 ${learnedQuerySource.shortName}；本次仍严格匹配船名、航次及起运港，目的港未命中时只保留开航信息并明确提示。${learnedUpdate.notes}`,''',
)

old_discovery_note = '''            notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${first.value.update.notes}`,'''
new_discovery_note = '''            notes: `未知船公司官方交叉识别：${carrier.shortName} 官网已验证船名、航次及起运港；目的港匹配状态以本次查询备注为准。${first.value.update.notes}`,'''
replace_once(tracking, old_discovery_note, new_discovery_note)

replace_once(
    tracking,
    '''              notes: `未知船公司官方交叉识别：${carrier.shortName} 的官网同时匹配船名、航次及有序两港。${officialMatch.update.notes}`,''',
    '''              notes: `未知船公司官方交叉识别：${carrier.shortName} 官网已验证船名、航次及起运港；目的港匹配状态以本次查询备注为准。${officialMatch.update.notes}`,''',
)

replace_once(
    dashboard,
    '''function shiftLabel(days: number, lateLabel: string) {
  if (days > 0) return `${lateLabel} ${days} 天`;
  if (days < 0) return `提前 ${Math.abs(days)} 天`;
  return "按原计划";
}

function routeLabel(shipment: Shipment) {''',
    '''function shiftLabel(days: number, lateLabel: string) {
  if (days > 0) return `${lateLabel} ${days} 天`;
  if (days < 0) return `提前 ${Math.abs(days)} 天`;
  return "按原计划";
}

function departureShiftDays(shipment: Shipment) {
  return scheduleShiftDays(
    shipment.atd || shipment.etd,
    shipment.baselineEtd || shipment.etd
  );
}

function arrivalShiftDays(shipment: Shipment) {
  return scheduleShiftDays(
    shipment.ata || shipment.eta,
    shipment.baselineEta || shipment.eta
  );
}

function shipmentHasScheduleDelay(shipment: Shipment) {
  const hasBaseline = Boolean(shipment.baselineEtd || shipment.baselineEta);
  return Boolean(
    shipment.status.includes("延期") ||
      departureShiftDays(shipment) > 0 ||
      arrivalShiftDays(shipment) > 0 ||
      (!hasBaseline && shipment.delayDays > 0)
  );
}

function hasPortMismatchWarning(shipment: Shipment) {
  return shipment.notes.includes("目的港信息不符");
}

function routeLabel(shipment: Shipment) {''',
)

replace_once(
    dashboard,
    '''    const delayed = current.filter(
      (item) => item.status.includes("延期") || item.delayDays > 0
    ).length;''',
    '''    const delayed = current.filter(shipmentHasScheduleDelay).length;''',
)

replace_once(
    dashboard,
    '''        (filter === "可能延期" && shipment.delayDays > 0);''',
    '''        (filter === "可能延期" && shipmentHasScheduleDelay(shipment));''',
)

replace_once(
    dashboard,
    '''            <div><p>需要关注</p><strong>{summary.delayed}</strong><small>延期或 ETA 变动</small></div>''',
    '''            <div><p>需要关注</p><strong>{summary.delayed}</strong><small>ETD / ETA 延后或状态异常</small></div>''',
)

replace_once(
    dashboard,
    '''            <div><strong>{summary.delayed} 票订单需要关注</strong><p>存在延期、ETA 变动或卸箱节点未确认。</p></div>''',
    '''            <div><strong>{summary.delayed} 票订单需要关注</strong><p>存在延期、ETD / ETA 变动或卸箱节点未确认。</p></div>''',
)

replace_once(
    dashboard,
    '''                        <td><span className="route-cell"><b>{shipment.portOfLoading || "—"}</b><i /><b>{shipment.portOfDischarge || "—"}</b></span></td>
                        <td><span className={statusClass(shipment.status)}>{shipment.status}</span>{shipment.delayDays > 0 && <small className="delay-note">晚 {shipment.delayDays} 天</small>}</td>
                        <td><strong className="date-value">{formatDate(shipment.atd || shipment.etd)}</strong><small>{shipment.atd ? "实际开船" : "计划开船"}</small></td>
                        <td><strong className="date-value">{formatDate(shipment.ata || shipment.eta)}</strong><small>{shipment.ata ? "实际到港" : "预计到港"}</small></td>''',
    '''                        <td><span className="route-cell"><b>{shipment.portOfLoading || "—"}</b><i /><b>{shipment.portOfDischarge || "—"}</b></span>{hasPortMismatchWarning(shipment) && <small className="delay-note">目的港信息不符</small>}</td>
                        <td><span className={statusClass(shipment.status)}>{shipment.status}</span></td>
                        <td><strong className="date-value">{formatDate(shipment.atd || shipment.etd)}</strong><small>{shipment.atd ? "实际开船" : "计划开船"}</small>{departureShiftDays(shipment) !== 0 && <small className={departureShiftDays(shipment) > 0 ? "delay-note" : undefined}>{shiftLabel(departureShiftDays(shipment), shipment.atd ? "晚开" : "延后")}</small>}</td>
                        <td><strong className="date-value">{formatDate(shipment.ata || shipment.eta)}</strong><small>{shipment.ata ? "实际到港" : "预计到港"}</small>{arrivalShiftDays(shipment) !== 0 && <small className={arrivalShiftDays(shipment) > 0 ? "delay-note" : undefined}>{shiftLabel(arrivalShiftDays(shipment), shipment.ata ? "晚到" : "延后")}</small>}</td>''',
)

replace_once(
    tests,
    '''  assert.match(tracking, /allowOoclInlandContinuation/);''',
    '''  assert.match(tracking, /allowDepartureOnly/);
  assert.match(tracking, /目的港信息不符/);
  assert.match(tracking, /ETA\/ATA 未由该海运挂港表验证/);
  assert.match(tracking, /portOfDischarge: pair/);
  assert.match(dashboard, /function departureShiftDays/);
  assert.match(dashboard, /function arrivalShiftDays/);
  assert.match(dashboard, /shipmentHasScheduleDelay/);
  assert.match(dashboard, /hasPortMismatchWarning/);
  assert.match(dashboard, /shipment\.atd \? "晚开" : "延后"/);
  assert.match(dashboard, /shipment\.ata \? "晚到" : "延后"/);
  assert.doesNotMatch(dashboard, /晚 \{shipment\.delayDays\} 天/);''',
)

Path(__file__).unlink()
