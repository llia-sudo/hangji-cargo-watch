from pathlib import Path

root = Path(__file__).resolve().parents[1]
tracking_path = root / "app" / "lib" / "tracking.ts"
tracker_path = root / "app" / "TrackerApp.tsx"
css_path = root / "app" / "globals.css"
test_path = root / "tests" / "cargo-watch.test.mjs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: expected source snippet not found")
    return text.replace(old, new, 1)


# 1) Tracking status: distinguish inferred in-transit from confirmed ATD.
tracking = tracking_path.read_text(encoding="utf-8")
tracking = replace_once(
    tracking,
    '''function scheduleStatus(etd: string, atd: string, eta: string, ata: string) {
  const now = chinaTimestamp();
  if (ata) return "已到港";
  if (atd) return eta && eta < now ? "可能延期" : "运输中";
  if (etd && etd >= now) return "待开船";
  if (eta && eta >= now) return "运输中";
  return "可能延期";
}''',
    '''function scheduleStatus(etd: string, atd: string, eta: string, ata: string) {
  const today = chinaTimestamp().slice(0, 10);
  const etdDate = etd.slice(0, 10);
  const etaDate = eta.slice(0, 10);
  if (ata) return "已到港";
  if (atd) return etaDate && etaDate < today ? "可能延期" : "运输中";
  if (etdDate && etdDate >= today) return "待开船";
  if (etdDate && etdDate < today && etaDate && etaDate >= today) return "预计运输中";
  return "可能延期";
}''',
    "scheduleStatus",
)

tracking = replace_once(
    tracking,
    '''    status: atd
      ? scheduleStatus(etd, atd, eta, ata)
      : etd && etd >= chinaTimestamp()
        ? "待开船"
        : "可能延期",''',
    '''    status: scheduleStatus(etd, atd, eta, ata),''',
    "Sinotrans status",
)

tracking = replace_once(
    tracking,
    '''  const today = now.slice(0, 10);
  const status = ata
    ? "已到港"
    : atd
      ? eta && eta.slice(0, 10) < today
        ? "可能延期"
        : "运输中"
      : etd && etd.slice(0, 10) < today
        ? "可能延期"
        : "待开船";''',
    '''  const today = now.slice(0, 10);
  const status = scheduleStatus(etd, atd, eta, ata);''',
    "PANCON status",
)

tracking = replace_once(
    tracking,
    '''  const status = ata
    ? "已到港"
    : atd
      ? eta && eta < now
        ? "可能延期"
        : "运输中"
      : etd && etd >= now
        ? "待开船"
        : eta && eta >= now
          ? "运输中"
          : "可能延期";''',
    '''  const status = scheduleStatus(etd, atd, eta, ata);''',
    "COSCO status",
)
tracking_path.write_text(tracking, encoding="utf-8")

# 2) Dashboard: include inferred in-transit in UI, filters and details.
tracker = tracker_path.read_text(encoding="utf-8")
tracker = replace_once(
    tracker,
    '''function statusClass(status: string) {
  if (status === "已到港") return "status arrived";
  if (status.includes("延期")) return "status delayed";
  if (status === "运输中") return "status sailing";
  if (status === "待开船") return "status waiting";
  return "status unknown";
}''',
    '''function statusClass(status: string) {
  if (status === "已到港") return "status arrived";
  if (status.includes("延期")) return "status delayed";
  if (status === "运输中" || status === "预计运输中") return "status sailing";
  if (status === "待开船") return "status waiting";
  return "status unknown";
}''',
    "statusClass",
)
tracker = replace_once(
    tracker,
    '''function completion(shipment: Shipment) {
  if (shipment.status === "已到港") return 100;
  if (shipment.status === "运输中" || shipment.status.includes("延期")) return 62;
  if (shipment.status === "待开船") return 24;
  return 8;
}''',
    '''function completion(shipment: Shipment) {
  if (shipment.status === "已到港") return 100;
  if (["运输中", "预计运输中"].includes(shipment.status) || shipment.status.includes("延期")) return 62;
  if (shipment.status === "待开船") return 24;
  return 8;
}''',
    "completion",
)
tracker = replace_once(
    tracker,
    '''function keyStrength(shipment: Shipment) {
  if (shipment.containerNo) return "箱号可直接跟踪";
  if (shipment.bookingNo || shipment.billOfLading) return "有提单 / Booking";
  if (shipment.vesselName && shipment.voyage) return "可跟踪船舶";
  return "需补充查询信息";
}''',
    '''function keyStrength(shipment: Shipment) {
  if (shipment.containerNo) return "箱号可直接跟踪";
  if (shipment.bookingNo || shipment.billOfLading) return "有提单 / Booking";
  if (shipment.vesselName && shipment.voyage) return "可跟踪船舶";
  return "需补充查询信息";
}

function statusDetail(shipment: Shipment) {
  if (shipment.status === "预计运输中" && !shipment.atd) {
    return `${shipment.etd ? `ETD ${formatDate(shipment.etd)} 已过 · ` : ""}尚未取得实际开船 ATD`;
  }
  return keyStrength(shipment);
}''',
    "statusDetail",
)
tracker = replace_once(
    tracker,
    '''    const active = current.filter((item) =>
      ["待开船", "运输中", "可能延期"].includes(item.status)
    ).length;''',
    '''    const active = current.filter((item) =>
      ["待开船", "运输中", "预计运输中", "可能延期"].includes(item.status)
    ).length;''',
    "summary active statuses",
)
tracker = replace_once(
    tracker,
    '''      const filterMatch =
        filter === "全部" ||
        shipment.status === filter ||
        (filter === "可能延期" && shipmentHasScheduleDelay(shipment));''',
    '''      const filterMatch =
        filter === "全部" ||
        shipment.status === filter ||
        (filter === "运输中" && shipment.status === "预计运输中") ||
        (filter === "可能延期" && shipmentHasScheduleDelay(shipment));''',
    "transport filter",
)

hero_actions = '''          <div className="hero-actions">
            <button className="button secondary" type="button" onClick={() => setModal("import")}>
              <span aria-hidden="true">↑</span> 导入 Excel
            </button>
            <button className="button primary" type="button" onClick={openAddShipment}>
              <span aria-hidden="true">+</span> 新增订单
            </button>
          </div>
'''
if hero_actions in tracker:
    tracker = tracker.replace(hero_actions, "", 1)
elif 'className="hero-actions"' in tracker:
    raise SystemExit("hero actions: unexpected markup")

tracker = replace_once(
    tracker,
    '''            <div className="panel-heading">
              <div><p className="eyebrow">订单清单</p><h2>{showArchived ? "已归档船次" : "当前船次"}</h2></div>
              <div className="panel-controls">''',
    '''            <div className="panel-heading">
              <div className="panel-title-group">
                <div><p className="eyebrow">订单清单</p><h2>{showArchived ? "已归档船次" : "当前船次"}</h2></div>
                <div className="panel-primary-actions">
                  <button className="button secondary" type="button" onClick={() => setModal("import")}><span aria-hidden="true">↑</span> 导入 Excel</button>
                  <button className="button primary" type="button" onClick={openAddShipment}><span aria-hidden="true">+</span> 新增订单</button>
                </div>
              </div>
              <div className="panel-controls">''',
    "panel action location",
)
tracker = replace_once(
    tracker,
    '''            <div><p>出运中</p><strong>{summary.active}</strong><small>待开船 / 运输中</small></div>''',
    '''            <div><p>出运中</p><strong>{summary.active}</strong><small>待开船 / 运输中（含预计）</small></div>''',
    "active summary copy",
)
tracker = replace_once(
    tracker,
    '''                        <td><span className={statusClass(shipment.status)}>{shipment.status}</span></td>''',
    '''                        <td><span className={statusClass(shipment.status)}>{shipment.status}</span>{shipment.status === "预计运输中" && <small className="estimated-transit-note">ATD 待确认</small>}</td>''',
    "table estimated transit note",
)
tracker = replace_once(
    tracker,
    '''            <div className="drawer-status"><span className={selected.archivedAt ? "status archived" : statusClass(selected.status)}>{selected.archivedAt ? "已归档" : selected.status}</span><small>{selected.archivedAt ? `归档于 ${selected.archivedAt.slice(0, 10)}` : keyStrength(selected)}</small></div>''',
    '''            <div className="drawer-status"><span className={selected.archivedAt ? "status archived" : statusClass(selected.status)}>{selected.archivedAt ? "已归档" : selected.status}</span><small>{selected.archivedAt ? `归档于 ${selected.archivedAt.slice(0, 10)}` : statusDetail(selected)}</small></div>''',
    "drawer status detail",
)
tracker = replace_once(
    tracker,
    '''{(selected.atd || selected.etd) && <div className="timeline-item done"><i /><div><strong>{selected.atd ? "已开船" : "已有计划开船时间"}</strong><small>{formatDate(selected.atd || selected.etd)}</small></div></div>}''',
    '''{(selected.atd || selected.etd) && <div className="timeline-item done"><i /><div><strong>{selected.atd ? "已开船" : selected.status === "预计运输中" ? "计划开船时间已过" : "已有计划开船时间"}</strong><small>{formatDate(selected.atd || selected.etd)}{selected.status === "预计运输中" && !selected.atd ? " · ATD 待确认" : ""}</small></div></div>}''',
    "drawer departure timeline",
)
tracker_path.write_text(tracker, encoding="utf-8")

# 3) CSS: compact actions next to Current Sailings + inferred status note.
css = css_path.read_text(encoding="utf-8")
css_marker = "/* Current sailings actions and estimated transit 2026-08-18 */"
css_block = r'''
/* Current sailings actions and estimated transit 2026-08-18 */
.panel-title-group {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.panel-primary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-primary-actions .button {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 11.5px;
}

.estimated-transit-note {
  color: #3e7c80;
  font-weight: 720;
}

@media (max-width: 900px) {
  .panel-heading {
    align-items: flex-start;
  }

  .panel-title-group {
    flex: 1 1 auto;
    flex-wrap: wrap;
  }
}

@media (max-width: 680px) {
  .panel-title-group {
    width: 100%;
    justify-content: space-between;
  }

  .panel-primary-actions {
    width: 100%;
  }

  .panel-primary-actions .button {
    flex: 1;
  }
}
'''
if css_marker not in css:
    css = css.rstrip() + "\n\n" + css_block.strip() + "\n"
css_path.write_text(css, encoding="utf-8")

# 4) Regression assertions.
tests = test_path.read_text(encoding="utf-8")
test_marker = 'test("expired ETD without ATD is shown as estimated in transit"'
test_block = r'''
test("expired ETD without ATD is shown as estimated in transit", async () => {
  const [tracking, dashboard, css] = await Promise.all([
    readFile(new URL("app/lib/tracking.ts", root), "utf8"),
    readFile(new URL("app/TrackerApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(tracking, /return "预计运输中"/);
  assert.match(tracking, /status: scheduleStatus\(etd, atd, eta, ata\)/);
  assert.match(dashboard, /status === "运输中" \|\| status === "预计运输中"/);
  assert.match(dashboard, /ATD 待确认/);
  assert.match(dashboard, /尚未取得实际开船 ATD/);
  assert.match(dashboard, /panel-primary-actions/);
  assert.match(dashboard, /导入 Excel/);
  assert.match(dashboard, /新增订单/);
  assert.doesNotMatch(dashboard, /className="hero-actions"/);
  assert.match(css, /Current sailings actions and estimated transit 2026-08-18/);
  assert.match(css, /\.panel-primary-actions \.button/);
});
'''
if test_marker not in tests:
    tests = tests.rstrip() + "\n\n" + test_block.strip() + "\n"
test_path.write_text(tests, encoding="utf-8")
