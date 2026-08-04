"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { downloadTemplate, ImportedShipment, parseShipmentFile } from "./lib/excel";

type Shipment = ImportedShipment & {
  id: number;
  atd: string;
  ata: string;
  delayDays: number;
  sourceUrl: string;
  lastCheckedAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type Modal = "add" | "import" | null;

const emptyDraft: ImportedShipment = {
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
  source: "手工录入",
};

const statusFilters = ["全部", "待查询", "待开船", "运输中", "可能延期", "已到港"];

function statusClass(status: string) {
  if (status === "已到港") return "status arrived";
  if (status.includes("延期")) return "status delayed";
  if (status === "运输中") return "status sailing";
  if (status === "待开船") return "status waiting";
  return "status unknown";
}

function formatDate(value: string) {
  if (!value) return "—";
  const normalized = value.slice(0, 10);
  const parts = normalized.split("-");
  if (parts.length !== 3) return value;
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function routeLabel(shipment: Shipment) {
  return `${shipment.portOfLoading || "起运港待补充"} → ${shipment.portOfDischarge || "目的港待补充"}`;
}

function completion(shipment: Shipment) {
  if (shipment.status === "已到港") return 100;
  if (shipment.status === "运输中" || shipment.status.includes("延期")) return 62;
  if (shipment.status === "待开船") return 24;
  return 8;
}

function keyStrength(shipment: Shipment) {
  if (shipment.containerNo) return "箱号可直接跟踪";
  if (shipment.bookingNo || shipment.billOfLading) return "有提单 / Booking";
  if (shipment.vesselName && shipment.voyage) return "可跟踪船舶";
  return "需补充查询信息";
}

export default function TrackerApp() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [draft, setDraft] = useState<ImportedShipment>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [importRows, setImportRows] = useState<ImportedShipment[]>([]);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  const loadShipments = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/shipments", { cache: "no-store" });
      const data = (await response.json()) as { shipments?: Shipment[]; error?: string };
      if (!response.ok) throw new Error(data.error || "读取订单失败");
      setShipments(data.shipments ?? []);
      if (quiet) setToast("已同步最新数据");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取订单失败");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    void loadShipments();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const summary = useMemo(() => {
    const total = shipments.length;
    const active = shipments.filter((item) =>
      ["待开船", "运输中", "可能延期"].includes(item.status)
    ).length;
    const delayed = shipments.filter(
      (item) => item.status.includes("延期") || item.delayDays > 0
    ).length;
    const arrived = shipments.filter((item) => item.status === "已到港").length;
    return { total, active, delayed, arrived };
  }, [shipments]);

  const filtered = useMemo(() => {
    const term = search.trim().toUpperCase();
    return shipments.filter((shipment) => {
      const filterMatch =
        filter === "全部" ||
        shipment.status === filter ||
        (filter === "可能延期" && shipment.delayDays > 0);
      const searchMatch =
        !term ||
        [
          shipment.orderNo,
          shipment.customerCode,
          shipment.vesselName,
          shipment.voyage,
          shipment.billOfLading,
          shipment.bookingNo,
          shipment.containerNo,
          shipment.portOfLoading,
          shipment.portOfDischarge,
        ].some((value) => value?.toUpperCase().includes(term));
      return filterMatch && searchMatch;
    });
  }, [filter, search, shipments]);

  const updateDraft = (field: keyof ImportedShipment, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const saveShipment = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.orderNo.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipment: draft }),
      });
      const data = (await response.json()) as { shipments?: Shipment[]; error?: string };
      if (!response.ok) throw new Error(data.error || "保存失败");
      setShipments(data.shipments ?? []);
      setDraft(emptyDraft);
      setModal(null);
      setToast("订单已保存，家里和办公室都可查看");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const rows = await parseShipmentFile(file);
      setFileName(file.name);
      setImportRows(rows);
    } catch (caught) {
      setFileName("");
      setImportRows([]);
      setError(caught instanceof Error ? caught.message : "读取文件失败");
    }
  };

  const importFile = async () => {
    if (!importRows.length) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipments: importRows }),
      });
      const data = (await response.json()) as {
        shipments?: Shipment[];
        imported?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "导入失败");
      setShipments(data.shipments ?? []);
      setImportRows([]);
      setFileName("");
      setModal(null);
      setToast(`已导入 ${data.imported ?? 0} 条订单`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setSaving(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void readFile(event.target.files?.[0]);
    event.target.value = "";
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span>航迹 <small>CARGO WATCH</small></span>
        </div>
        <nav aria-label="主导航">
          <a className="nav-active" href="#orders">订单跟踪</a>
          <a href="#sources">数据源</a>
          <a href="#help">使用帮助</a>
        </nav>
        <div className="top-actions">
          <span className="avatar">AP</span>
        </div>
      </header>

      <section className="workspace">
        <div className="hero-row">
          <div>
            <p className="eyebrow">海运订单总览</p>
            <h1>每一票货，现在都到哪里了？</h1>
            <p className="hero-copy">集中管理船名航次、箱号、ETD 和 ETA，快速找出延期和信息缺失的订单。</p>
          </div>
          <div className="hero-actions">
            <button className="button secondary" type="button" onClick={() => setModal("import")}>
              <span aria-hidden="true">↑</span> 导入 Excel
            </button>
            <button className="button primary" type="button" onClick={() => setModal("add")}>
              <span aria-hidden="true">+</span> 新增订单
            </button>
          </div>
        </div>

        <section className="summary-grid" aria-label="订单概况">
          <article className="summary-card total-card">
            <span className="summary-icon">▦</span>
            <div><p>在管订单</p><strong>{summary.total}</strong><small>云端同步</small></div>
            <span className="spark"><i /><i /><i /><i /><i /><i /></span>
          </article>
          <article className="summary-card active-card">
            <span className="summary-icon">≋</span>
            <div><p>出运中</p><strong>{summary.active}</strong><small>待开船 / 运输中</small></div>
            <span className="tiny-ring" style={{ "--value": `${Math.max(8, summary.total ? (summary.active / summary.total) * 100 : 8)}%` } as React.CSSProperties} />
          </article>
          <article className="summary-card delay-card">
            <span className="summary-icon">!</span>
            <div><p>需要关注</p><strong>{summary.delayed}</strong><small>延期或 ETA 变动</small></div>
            <span className="trend-up">↗</span>
          </article>
          <article className="summary-card arrived-card">
            <span className="summary-icon">✓</span>
            <div><p>已到港</p><strong>{summary.arrived}</strong><small>本批订单</small></div>
            <span className="check-orbit">✓</span>
          </article>
        </section>

        {summary.delayed > 0 && (
          <aside className="attention-banner" role="status">
            <span className="attention-mark">!</span>
            <div><strong>{summary.delayed} 票订单需要关注</strong><p>存在延期、ETA 变动或卸箱节点未确认。</p></div>
            <button type="button" onClick={() => setFilter("可能延期")}>仅看异常 →</button>
          </aside>
        )}

        <section className="content-grid" id="orders">
          <div className="orders-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">订单清单</p><h2>所有订单</h2></div>
              <button className="sync-button" type="button" disabled={syncing} onClick={() => void loadShipments(true)}>
                <span className={syncing ? "spin" : ""}>↻</span> {syncing ? "同步中" : "同步数据"}
              </button>
            </div>
            <div className="toolbar">
              <label className="search-box">
                <span aria-hidden="true">⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索订单号、船名、提单号或箱号" />
              </label>
              <div className="filter-row" aria-label="按状态筛选">
                {statusFilters.map((item) => (
                  <button className={filter === item ? "filter-active" : ""} type="button" key={item} onClick={() => setFilter(item)}>{item}</button>
                ))}
              </div>
            </div>

            {error && <div className="error-box" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div>}

            <div className="table-wrap">
              <table>
                <thead><tr><th>订单 / 客户</th><th>船名航次</th><th>航线</th><th>状态</th><th>ETD / ATD</th><th>ETA / ATA</th><th>数据来源</th><th /></tr></thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <tr key={index}><td colSpan={8}><Skeleton height={38} borderRadius={10} /></td></tr>
                    ))
                  ) : filtered.length ? (
                    filtered.map((shipment) => (
                      <tr key={shipment.id} onClick={() => setSelected(shipment)}>
                        <td><strong>{shipment.orderNo}</strong><small>{shipment.customerCode || "未填客户编号"}</small></td>
                        <td><span className="vessel-name">{shipment.vesselName || "待补充"}</span><small>{shipment.voyage || "航次待补充"}</small></td>
                        <td><span className="route-cell"><b>{shipment.portOfLoading || "—"}</b><i /><b>{shipment.portOfDischarge || "—"}</b></span></td>
                        <td><span className={statusClass(shipment.status)}>{shipment.status}</span>{shipment.delayDays > 0 && <small className="delay-note">晚 {shipment.delayDays} 天</small>}</td>
                        <td><strong className="date-value">{formatDate(shipment.atd || shipment.etd)}</strong><small>{shipment.atd ? "实际开船" : "计划开船"}</small></td>
                        <td><strong className="date-value">{formatDate(shipment.ata || shipment.eta)}</strong><small>{shipment.ata ? "实际到港" : "预计到港"}</small></td>
                        <td><span className="source-name">{shipment.source || "手工录入"}</span><small>{shipment.lastCheckedAt ? `更新 ${shipment.lastCheckedAt.slice(5, 16)}` : "等待首次查询"}</small></td>
                        <td><button className="row-button" type="button" aria-label={`查看 ${shipment.orderNo}`} title="查看订单详情" onClick={(event) => { event.stopPropagation(); setSelected(shipment); }}>›</button></td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={8}><div className="empty-state"><span>⌕</span><strong>没有找到匹配订单</strong><p>试试其他搜索词或状态。</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="panel-footer"><span>显示 {filtered.length} / {shipments.length} 票</span><span>订单号相同时，再次导入会更新原记录</span></div>
          </div>

          <aside className="side-panel" id="sources">
            <div className="side-heading"><p className="eyebrow">查询健康度</p><h2>数据源准备度</h2></div>
            <div className="health-score"><div><strong>78</strong><span>/100</span></div><p>可进入试用</p></div>
            <ul className="source-list">
              <li><span className="source-dot ready" /><div><strong>Evergreen ShipmentLink</strong><small>箱号查询样例已验证</small></div><b>已验证</b></li>
              <li><span className="source-dot ready" /><div><strong>PANCON / 仁川港</strong><small>船名航次匹配已验证</small></div><b>已验证</b></li>
              <li><span className="source-dot pending" /><div><strong>AIS 船位</strong><small>待选定长期数据来源</small></div><b className="pending-label">待接入</b></li>
            </ul>
            <div className="source-callout">
              <span>◎</span><div><strong>官网查询接入说明</strong><p>当前版本先完成订单云端管理与批量导入。自动访问船公司官网将按船公司逐个接入。</p></div>
            </div>
            <div className="tips-card" id="help">
              <p className="eyebrow">信息建议</p><strong>如何提高查询成功率？</strong>
              <ol><li>优先填写集装箱号</li><li>补充船名和航次</li><li>区分货代提单与船东提单</li></ol>
            </div>
          </aside>
        </section>
      </section>

      {modal === "add" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section className="modal-card add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><p className="eyebrow">手工录入</p><h2 id="add-title">新增一票订单</h2></div><button type="button" onClick={() => setModal(null)} aria-label="关闭">×</button></div>
            <form onSubmit={saveShipment}>
              <div className="form-grid">
                <label><span>订单号 <b>*</b></span><input required value={draft.orderNo} onChange={(e) => updateDraft("orderNo", e.target.value)} placeholder="例如 226GRD0390" /></label>
                <label><span>客户编号</span><input value={draft.customerCode} onChange={(e) => updateDraft("customerCode", e.target.value)} placeholder="可选" /></label>
                <label><span>船名</span><input value={draft.vesselName} onChange={(e) => updateDraft("vesselName", e.target.value)} placeholder="TAMPA TRIUMPH" /></label>
                <label><span>航次</span><input value={draft.voyage} onChange={(e) => updateDraft("voyage", e.target.value)} placeholder="0789-043E" /></label>
                <label><span>提单号</span><input value={draft.billOfLading} onChange={(e) => updateDraft("billOfLading", e.target.value)} /></label>
                <label><span>Booking No.</span><input value={draft.bookingNo} onChange={(e) => updateDraft("bookingNo", e.target.value)} /></label>
                <label className="wide"><span>集装箱号</span><input value={draft.containerNo} onChange={(e) => updateDraft("containerNo", e.target.value)} placeholder="有箱号时优先填写" /></label>
                <label><span>起运港</span><input value={draft.portOfLoading} onChange={(e) => updateDraft("portOfLoading", e.target.value)} placeholder="SHANGHAI" /></label>
                <label><span>目的港</span><input value={draft.portOfDischarge} onChange={(e) => updateDraft("portOfDischarge", e.target.value)} placeholder="INCHON" /></label>
                <label><span>计划开船 ETD</span><input type="date" value={draft.etd} onChange={(e) => updateDraft("etd", e.target.value)} /></label>
                <label><span>预计到港 ETA</span><input type="date" value={draft.eta} onChange={(e) => updateDraft("eta", e.target.value)} /></label>
              </div>
              <div className="form-hint"><span>ℹ</span><p>只有订单号是必填项。其他信息可以稍后通过 Excel 更新。</p></div>
              <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={saving} type="submit">{saving ? "保存中…" : "保存订单"}</button></div>
            </form>
          </section>
        </div>
      )}

      {modal === "import" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section className="modal-card import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><p className="eyebrow">批量建立订单</p><h2 id="import-title">导入 Excel 或 CSV</h2></div><button type="button" onClick={() => setModal(null)} aria-label="关闭">×</button></div>
            <label className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); }}>
              <input type="file" accept=".xlsx,.csv" onChange={handleFileInput} />
              <span className="upload-mark">↑</span>
              <strong>{fileName || "把 Excel 拖到这里，或点击选择"}</strong>
              <p>支持 .xlsx 和 .csv，单次最多 200 票，文件不超过 5MB</p>
            </label>
            <div className="template-row"><div><strong>第一次导入？</strong><p>下载带有正确列名和两条示例的模板。</p></div><button type="button" onClick={downloadTemplate}>下载导入模板</button></div>
            {importRows.length > 0 && (
              <div className="preview-box"><div className="preview-heading"><strong>已识别 {importRows.length} 条订单</strong><span>订单号重复时会更新原记录</span></div><div className="preview-rows">{importRows.slice(0, 4).map((row) => <div key={row.orderNo}><strong>{row.orderNo}</strong><span>{row.vesselName || "船名待补充"} {row.voyage}</span><small>{row.portOfLoading || "—"} → {row.portOfDischarge || "—"}</small></div>)}{importRows.length > 4 && <p>还有 {importRows.length - 4} 条…</p>}</div></div>
            )}
            <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setModal(null)}>取消</button><button className="button primary" type="button" disabled={!importRows.length || saving} onClick={() => void importFile()}>{saving ? "导入中…" : `导入 ${importRows.length || ""} 条订单`}</button></div>
          </section>
        </div>
      )}

      {selected && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-heading"><div><p className="eyebrow">订单详情</p><h2 id="detail-title">{selected.orderNo}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></div>
            <div className="drawer-status"><span className={statusClass(selected.status)}>{selected.status}</span><small>{keyStrength(selected)}</small></div>
            <section className="route-visual">
              <div className="route-labels"><div><span>起运港</span><strong>{selected.portOfLoading || "待补充"}</strong></div><div><span>目的港</span><strong>{selected.portOfDischarge || "待补充"}</strong></div></div>
              <div className="route-track"><i className="route-progress" style={{ width: `${completion(selected)}%` }} /><span className="port-dot origin" /><span className="ship-dot" style={{ left: `calc(${completion(selected)}% - 14px)` }}>▲</span><span className="port-dot destination" /></div>
              <p>{routeLabel(selected)}</p>
            </section>
            <div className="date-grid"><div><span>ETD / ATD</span><strong>{formatDate(selected.atd || selected.etd)}</strong><small>{selected.atd ? "实际开船" : "计划开船"}</small></div><div><span>ETA / ATA</span><strong>{formatDate(selected.ata || selected.eta)}</strong><small>{selected.ata ? "实际到港" : "预计到港"}</small></div>{selected.delayDays > 0 && <div className="delay-box"><span>延期</span><strong>+{selected.delayDays} 天</strong><small>与原计划比较</small></div>}</div>
            <section className="detail-section"><h3>运输标识</h3><dl><div><dt>船名 / 航次</dt><dd>{selected.vesselName || "—"} {selected.voyage}</dd></div><div><dt>集装箱号</dt><dd>{selected.containerNo || "—"}</dd></div><div><dt>提单号</dt><dd>{selected.billOfLading || "—"}</dd></div><div><dt>Booking No.</dt><dd>{selected.bookingNo || "—"}</dd></div></dl></section>
            <section className="detail-section timeline"><h3>当前跟踪摘要</h3><div className="timeline-item done"><i /><div><strong>订单已建立</strong><small>{selected.createdAt?.slice(0, 10)}</small></div></div>{(selected.atd || selected.etd) && <div className="timeline-item done"><i /><div><strong>{selected.atd ? "已开船" : "已有计划开船时间"}</strong><small>{formatDate(selected.atd || selected.etd)}</small></div></div>}<div className={`timeline-item ${selected.status === "已到港" ? "done" : "current"}`}><i /><div><strong>{selected.status}</strong><small>{selected.notes || "等待更多节点"}</small></div></div>{selected.eta && <div className={`timeline-item ${selected.ata ? "done" : "future"}`}><i /><div><strong>{selected.ata ? "已到达目的港" : "预计到达"}</strong><small>{formatDate(selected.ata || selected.eta)}</small></div></div>}</section>
            <section className="source-detail"><span className="source-dot ready" /><div><strong>{selected.source}</strong><small>{selected.lastCheckedAt ? `最后记录：${selected.lastCheckedAt}` : "等待首次查询"}</small></div>{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">打开官网 ↗</a>}</section>
          </aside>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
