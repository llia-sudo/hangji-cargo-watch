from pathlib import Path

root = Path(__file__).resolve().parents[1]
tracker_path = root / "app" / "TrackerApp.tsx"
css_path = root / "app" / "globals.css"
test_path = root / "tests" / "cargo-watch.test.mjs"

tracker = tracker_path.read_text(encoding="utf-8")
old_route = '''<td><span className="route-cell"><b>{shipment.portOfLoading || "—"}</b><i /><b>{shipment.portOfDischarge || "—"}</b></span>{hasPortMismatchWarning(shipment) && <small className="delay-note">目的港信息不符</small>}</td>'''
new_route = '''<td><span className="route-cell"><b>{shipment.portOfLoading || "—"}</b><i aria-hidden="true">→</i><b>{shipment.portOfDischarge || "—"}</b></span>{hasPortMismatchWarning(shipment) && <small className="route-warning">海运挂港不符</small>}</td>'''
if old_route not in tracker and new_route not in tracker:
    raise SystemExit("route cell source snippet not found")
if old_route in tracker:
    tracker = tracker.replace(old_route, new_route, 1)
tracker_path.write_text(tracker, encoding="utf-8")

css = css_path.read_text(encoding="utf-8")
marker = "/* Desktop readability refresh 2026-08-18 */"
block = r'''

/* Desktop readability refresh 2026-08-18 */
@media (min-width: 769px) {
  .orders-panel .panel-heading h2 {
    font-size: 23px;
  }

  .orders-panel .panel-heading .eyebrow {
    font-size: 11px;
  }

  .orders-panel .archive-view-switch button,
  .orders-panel .sync-button,
  .orders-panel .filter-row button,
  .orders-panel .search-box input {
    font-size: 12.5px;
  }

  .orders-panel th {
    padding: 13px 15px;
    font-size: 11.5px;
    letter-spacing: 0.015em;
  }

  .orders-panel td {
    min-width: 105px;
    padding: 17px 15px;
    font-size: 13px;
    line-height: 1.45;
    vertical-align: middle;
  }

  .orders-panel td > strong {
    font-size: 14px;
  }

  .orders-panel td small {
    font-size: 11.5px;
    line-height: 1.45;
  }

  .orders-panel .vessel-name {
    font-size: 13.5px;
    font-weight: 780;
  }

  .orders-panel .single-sync-button,
  .orders-panel .edit-row-button,
  .orders-panel .archive-row-button {
    font-size: 11px;
  }

  .orders-panel .status {
    font-size: 11.5px;
  }

  .orders-panel .date-value {
    font-size: 14px;
    line-height: 1.25;
  }

  .orders-panel .source-name {
    font-size: 12.5px;
  }

  .orders-panel .panel-footer {
    font-size: 11.5px;
  }

  .route-cell {
    display: flex;
    grid-template-columns: none;
    align-items: center;
    gap: 8px;
    min-width: 180px;
    white-space: nowrap;
  }

  .route-cell b {
    color: #3d566b;
    font-size: 12.5px;
    font-weight: 720;
  }

  .route-cell b:last-child {
    color: var(--navy);
    font-weight: 800;
  }

  .route-cell i {
    position: static;
    height: auto;
    flex: 0 0 auto;
    background: none;
    color: var(--teal);
    font-size: 15px;
    font-style: normal;
    font-weight: 850;
    line-height: 1;
  }

  .route-cell i::before,
  .route-cell i::after {
    display: none;
  }

  .route-warning {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    margin-top: 7px;
    padding: 3px 7px;
    border: 1px solid rgba(229, 111, 89, 0.24);
    border-radius: 999px;
    background: var(--coral-soft);
    color: #bd5a47;
    font-size: 10.5px !important;
    font-weight: 760;
    line-height: 1.2;
  }

  .detail-drawer {
    width: min(540px, 100%);
  }

  .detail-drawer .drawer-heading {
    padding: 26px 28px 20px;
  }

  .detail-drawer .drawer-heading h2 {
    font-size: 24px;
  }

  .detail-drawer .eyebrow {
    font-size: 11px;
  }

  .detail-drawer .drawer-status {
    padding-left: 28px;
    padding-right: 28px;
  }

  .detail-drawer .drawer-status .status {
    font-size: 12px;
  }

  .detail-drawer .drawer-status small {
    font-size: 12px;
  }

  .detail-drawer .route-visual {
    margin-left: 28px;
    margin-right: 28px;
  }

  .detail-drawer .route-labels span,
  .detail-drawer .route-visual > p {
    font-size: 11.5px;
  }

  .detail-drawer .route-labels strong {
    font-size: 14.5px;
  }

  .detail-drawer .date-grid {
    margin-left: 28px;
    margin-right: 28px;
  }

  .detail-drawer .date-comparison-card > span {
    font-size: 12px;
  }

  .detail-drawer .date-comparison-row small {
    font-size: 11.5px;
  }

  .detail-drawer .date-comparison-row strong {
    font-size: 18px;
  }

  .detail-drawer .date-comparison-row em {
    font-size: 11.5px;
  }

  .detail-drawer .detail-section {
    margin-left: 28px;
    margin-right: 28px;
  }

  .detail-drawer .detail-section h3 {
    font-size: 14px;
  }

  .detail-drawer .detail-section dt {
    font-size: 11.5px;
  }

  .detail-drawer .detail-section dd {
    margin-top: 5px;
    font-size: 13.5px;
    line-height: 1.5;
  }

  .detail-drawer .timeline-item strong {
    font-size: 13.5px;
  }

  .detail-drawer .timeline-item small {
    font-size: 12.5px;
    line-height: 1.5;
  }

  .detail-drawer .schedule-history-heading span,
  .detail-drawer .schedule-history-time small,
  .detail-drawer .schedule-history-dates span {
    font-size: 11.5px;
  }

  .detail-drawer .schedule-history-time strong,
  .detail-drawer .schedule-history-dates strong {
    font-size: 13px;
  }

  .detail-drawer .schedule-history-entry p,
  .detail-drawer .schedule-history-dates small,
  .detail-drawer .schedule-history-empty {
    font-size: 12px;
    line-height: 1.5;
  }

  .detail-drawer .source-detail strong {
    font-size: 13.5px;
  }

  .detail-drawer .source-detail small,
  .detail-drawer .source-detail a {
    font-size: 11.5px;
  }
}
'''
if marker not in css:
    css = css.rstrip() + block + "\n"
css_path.write_text(css, encoding="utf-8")

tests = test_path.read_text(encoding="utf-8")
test_marker = 'test("desktop shipment UI uses readable route and detail typography"'
if test_marker not in tests:
    tests += r'''

test("desktop shipment UI uses readable route and detail typography", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(new URL("app/TrackerApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(dashboard, /route-warning/);
  assert.match(dashboard, />→<\/i>/);
  assert.match(dashboard, /海运挂港不符/);
  assert.match(css, /Desktop readability refresh 2026-08-18/);
  assert.match(css, /\.orders-panel th[\s\S]*font-size: 11\.5px/);
  assert.match(css, /\.orders-panel td[\s\S]*font-size: 13px/);
  assert.match(css, /\.route-cell b[\s\S]*font-size: 12\.5px/);
  assert.match(css, /\.detail-drawer[\s\S]*width: min\(540px, 100%\)/);
  assert.match(css, /\.detail-drawer \.detail-section dd[\s\S]*font-size: 13\.5px/);
  assert.match(css, /\.detail-drawer \.date-comparison-row strong[\s\S]*font-size: 18px/);
});
'''
    test_path.write_text(tests, encoding="utf-8")
