"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { downloadTemplate, ImportedShipment, parseShipmentFile } from "./lib/excel";
import {
  carrierTrackingUrl,
  carriers,
  detectCarrier,
} from "./lib/carriers";

type Shipment = ImportedShipment & {
  id: number;
  baselineEtd: string;
  baselineEta: string;
  atd: string;
  ata: string;
  delayDays: number;
  sourceUrl: string;
  lastCheckedAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
  scheduleHistory: ScheduleHistoryEntry[];
};

type ScheduleHistoryEntry = {
  id: number;
  shipmentId: number;
  checkedAt: string;
  vesselName: string;
  voyage: string;
  status: string;
  etd: string;
  atd: string;
  eta: string;
  ata: string;
  source: string;
};

type SyncResponse = {
  shipments?: Shipment[];
  summary?: {
    total: number;
    succeeded: number;
    identified: number;
    failed: number;
  };
  results?: Array<{
    ok: boolean;
    identified?: boolean;
    orderNo: string;
    message: string;
  }>;
  error?: string;
};

type SyncFailureDetail = {
  orderNo: string;
  message: string;
};

type Modal = "add" | "edit" | "import" | null;

type ShipmentDraft = ImportedShipment & {
  notes: string;
};

const emptyDraft: ShipmentDraft = {
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
  notes: "",
};

const statusFilters = ["全部", "待查询", "待开船", "运输中", "可能延期", "已到港"];
const automaticCarrierCount = carriers.filter(
  (carrier) => carrier.queryMode === "automatic"
).length;

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

function formatCheckedAt(value: string) {
  if (!value) return "查询时间未记录";
  const date = formatDate(value);
  const time = value.match(/\d{2}:\d{2}/)?.[0];
  return `${date}${time ? ` ${time}` : ""} 查询`;
}

function scheduleShiftDays(current?: string, previous?: string) {
  if (!current || !previous) return 0;
  const currentTime = Date.parse(`${current.slice(0, 10)}T00:00:00Z`);
  const previousTime = Date.parse(`${previous.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(currentTime) || !Number.isFinite(previousTime)) return 0;
  return Math.round((currentTime - previousTime) / 86_400_000);
}

function shiftLabel(days: number, lateLabel: string) {
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

function shipmentSourceUrl(shipment: Shipment) {
  if (shipment.sourceUrl) return shipment.sourceUrl;
  const carrier = detectCarrier(shipment);
  return carrier ? carrierTrackingUrl(carrier, shipment) : "";
}

export default function TrackerApp() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingOrderNo, setSyncingOrderNo] = useState("");
  const [archivingOrderNo, setArchivingOrderNo] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [syncFailureDetails, setSyncFailureDetails] = useState<SyncFailureDetail[]>([]);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [draft, setDraft] = useState<ShipmentDraft>(emptyDraft);
  const [editingShipmentId, setEditingShipmentId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [importRows, setImportRows] = useState<ImportedShipment[]>([]);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  const loadShipments = async () => {
    setLoading(true);
    setError("");
    setSyncFailureDetails([]);
    try {
      const response = await fetch("/api/shipments", { cache: "no-store" });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as { shipments?: Shipment[]; error?: string };
      if (!response.ok) throw new Error(data.error || "读取订单失败");
      setShipments(data.shipments ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取订单失败");
    } finally {
      setLoading(false);
    }
  };

  const applySyncResponse = (data: SyncResponse, singleOrderNo?: string) => {
    const updated = data.shipments ?? [];
    setShipments(updated);
    setSelected((current) =>
      current ? updated.find((item) => item.id === current.id) ?? current : null
    );

    if (singleOrderNo) {
      setSyncFailureDetails([]);
      const result = data.results?.find(
        (item) => item.orderNo === singleOrderNo
      );
      if (result?.ok) {
        setToast(`${singleOrderNo} 船期已更新`);
      } else if (result?.identified) {
        setToast(`${singleOrderNo}：${result.message}`);
      } else {
        setError(`${singleOrderNo}：${result?.message || "暂未查询到船期"}`);
      }
      return;
    }

    const total = data.summary?.total ?? updated.length;
    const succeeded = data.summary?.succeeded ?? 0;
    const identified = data.summary?.identified ?? 0;
    const failed = data.summary?.failed ?? 0;
    setToast(`已查询 ${total} 票，船期更新 ${succeeded} 票${identified ? `，识别船公司 ${identified} 票` : ""}`);
    if (failed > 0) {
      const details = (data.results ?? [])
        .filter((result) => !result.ok && !result.identified)
        .map((result) => ({
          orderNo: result.orderNo,
          message: result.message,
        }));
      setSyncFailureDetails(details);
      setError(`${failed} 票暂未更新`);
    } else {
      setSyncFailureDetails([]);
      setError("");
    }
  };

  const syncAllShipments = async () => {
    if (!shipments.length) return;
    setSyncing(true);
    setError("");
    setSyncFailureDetails([]);
    try {
      const response = await fetch("/api/shipments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as SyncResponse;
      if (!response.ok) throw new Error(data.error || "批量查询失败");
      applySyncResponse(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量查询失败");
    } finally {
      setSyncing(false);
    }
  };

  const syncOneShipment = async (shipment: Shipment) => {
    if (syncing || syncingOrderNo) return;
    setSyncingOrderNo(shipment.orderNo);
    setError("");
    setSyncFailureDetails([]);
    try {
      const response = await fetch("/api/shipments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: shipment.orderNo }),
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as SyncResponse;
      if (!response.ok) throw new Error(data.error || "单票查询失败");
      applySyncResponse(data, shipment.orderNo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "单票查询失败");
    } finally {
      setSyncingOrderNo("");
    }
  };

  const setShipmentArchived = async (shipment: Shipment, archived: boolean) => {
    if (archivingOrderNo) return;
    setArchivingOrderNo(shipment.orderNo);
    setError("");
    try {
      const response = await fetch("/api/shipments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: shipment.orderNo, archived }),
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as {
        shipments?: Shipment[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "归档操作失败");
      setShipments(data.shipments ?? []);
      setSelected(null);
      setToast(`${shipment.orderNo} 已${archived ? "归档" : "恢复"}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "归档操作失败");
    } finally {
      setArchivingOrderNo("");
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
    const current = shipments.filter((item) => !item.archivedAt);
    const total = current.length;
    const active = current.filter((item) =>
      ["待开船", "运输中", "可能延期"].includes(item.status)
    ).length;
    const delayed = current.filter(shipmentHasScheduleDelay).length;
    const arrived = current.filter((item) => item.status === "已到港").length;
    const archived = shipments.length - total;
    return { total, active, delayed, arrived, archived };
  }, [shipments]);

  const filtered = useMemo(() => {
    const term = search.trim().toUpperCase();
    return shipments.filter((shipment) => {
      const archiveMatch = showArchived
        ? Boolean(shipment.archivedAt)
        : !shipment.archivedAt;
      const filterMatch =
        filter === "全部" ||
        shipment.status === filter ||
        (filter === "可能延期" && shipmentHasScheduleDelay(shipment));
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
      return archiveMatch && filterMatch && searchMatch;
    });
  }, [filter, search, shipments, showArchived]);

  const updateDraft = (field: keyof ShipmentDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const openAddShipment = () => {
    setEditingShipmentId(null);
    setDraft(emptyDraft);
    setModal("add");
  };

  const openEditShipment = (shipment: Shipment) => {
    setEditingShipmentId(shipment.id);
    setDraft({
      orderNo: shipment.orderNo,
      customerCode: shipment.customerCode,
      vesselName: shipment.vesselName,
      voyage: shipment.voyage,
      billOfLading: shipment.billOfLading,
      bookingNo: shipment.bookingNo,
      containerNo: shipment.containerNo,
      portOfLoading: shipment.portOfLoading,
      portOfDischarge: shipment.portOfDischarge,
      etd: shipment.etd,
      eta: shipment.eta,
      status: shipment.status,
      source: shipment.source || "手工录入",
      notes: shipment.notes || "",
    });
    setModal("edit");
  };

  const saveShipment = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.orderNo.trim()) return;
    setSaving(true);
    setError("");
    try {
      const editing = editingShipmentId !== null;
      const response = await fetch("/api/shipments", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { action: "edit", id: editingShipmentId, shipment: draft }
            : { shipment: draft }
        ),
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      const data = (await response.json()) as { shipments?: Shipment[]; error?: string };
      if (!response.ok) throw new Error(data.error || "保存失败");
      const updated = data.shipments ?? [];
      setShipments(updated);
      if (editingShipmentId !== null) {
        setSelected(updated.find((item) => item.id === editingShipmentId) ?? null);
      }
      setDraft(emptyDraft);
      setEditingShipmentId(null);
      setModal(null);
      setToast(editing ? "订单信息已更新，船期变化记录已保留" : "订单已保存，家里和办公室都可查看");
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
      if (response.status === 401) {
        window.location.reload();
        return;
      }
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

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
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
          <a href="#carriers">船公司网络</a>
          <a href="#help">使用帮助</a>
        </nav>
        <div className="top-actions">
          <span className="avatar">AP</span>
          <button className="signout-button" type="button" onClick={() => void signOut()}>退出</button>
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
            <button className="button primary" type="button" onClick={openAddShipment}>
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
            <div><p>需要关注</p><strong>{summary.delayed}</strong><small>ETD / ETA 延后或状态异常</small></div>
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
            <div><strong>{summary.delayed} 票订单需要关注</strong><p>存在延期、ETD / ETA 变动或卸箱节点未确认。</p></div>
            <button type="button" onClick={() => setFilter("可能延期")}>仅看异常 →</button>
          </aside>
        )}

        <section className="content-grid" id="orders">
          <div className="orders-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">订单清单</p><h2>{showArchived ? "已归档船次" : "当前船次"}</h2></div>
              <div className="panel-controls">
                <div className="archive-view-switch" aria-label="订单归档视图">
                  <button className={!showArchived ? "active" : ""} type="button" onClick={() => setShowArchived(false)}>当前 {summary.total}</button>
                  <button className={showArchived ? "active" : ""} type="button" onClick={() => setShowArchived(true)}>已归档 {summary.archived}</button>
                </div>
                {!showArchived && <button className="sync-button" type="button" disabled={syncing || Boolean(syncingOrderNo) || loading || !summary.total} onClick={() => void syncAllShipments()}>
                  <span className={syncing ? "spin" : ""}>↻</span> {syncing ? "正在查询全部订单" : "一键更新全部"}
                </button>}
              </div>
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

            {error && (
              <div className="error-box" role="alert">
                <strong>{error}</strong>
                {syncFailureDetails.length > 0 && (
                  <ul>
                    {syncFailureDetails.map((detail) => (
                      <li key={`${detail.orderNo}-${detail.message}`}>
                        <b>{detail.orderNo}</b>
                        <span>{detail.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" aria-label="关闭错误提示" onClick={() => { setError(""); setSyncFailureDetails([]); }}>×</button>
              </div>
            )}

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
                      <tr className={shipment.archivedAt ? "archived-row" : ""} key={shipment.id} onClick={() => setSelected(shipment)}>
                        <td><strong>{shipment.orderNo}</strong><small>{shipment.customerCode || "未填客户编号"}</small></td>
                        <td><span className="vessel-name">{shipment.vesselName || "待补充"}</span><span className="voyage-action"><small>{shipment.voyage || "航次待补充"}</small><button className="single-sync-button" type="button" disabled={syncing || Boolean(syncingOrderNo)} aria-label={`只查询 ${shipment.orderNo} ${shipment.vesselName} ${shipment.voyage}`} title="只查询这一票" onClick={(event) => { event.stopPropagation(); void syncOneShipment(shipment); }}><span className={syncingOrderNo === shipment.orderNo ? "spin" : ""}>↻</span>{syncingOrderNo === shipment.orderNo ? "查询中" : "查询"}</button></span></td>
                        <td><span className="route-cell"><b>{shipment.portOfLoading || "—"}</b><i /><b>{shipment.portOfDischarge || "—"}</b></span>{hasPortMismatchWarning(shipment) && <small className="delay-note">目的港信息不符</small>}</td>
                        <td><span className={statusClass(shipment.status)}>{shipment.status}</span></td>
                        <td><strong className="date-value">{formatDate(shipment.atd || shipment.etd)}</strong><small>{shipment.atd ? "实际开船" : "计划开船"}</small>{departureShiftDays(shipment) !== 0 && <small className={departureShiftDays(shipment) > 0 ? "delay-note" : undefined}>{shiftLabel(departureShiftDays(shipment), shipment.atd ? "晚开" : "延后")}</small>}</td>
                        <td><strong className="date-value">{formatDate(shipment.ata || shipment.eta)}</strong><small>{shipment.ata ? "实际到港" : "预计到港"}</small>{arrivalShiftDays(shipment) !== 0 && <small className={arrivalShiftDays(shipment) > 0 ? "delay-note" : undefined}>{shiftLabel(arrivalShiftDays(shipment), shipment.ata ? "晚到" : "延后")}</small>}</td>
                        <td><span className="source-name">{shipment.source || "手工录入"}</span><small>{shipment.lastCheckedAt ? `更新 ${shipment.lastCheckedAt.slice(5, 16)}` : "等待首次查询"}</small></td>
                        <td><span className="row-action-group"><button className="row-button" type="button" aria-label={`查看 ${shipment.orderNo}`} title="查看订单详情" onClick={(event) => { event.stopPropagation(); setSelected(shipment); }}>›</button><button className="edit-row-button" type="button" aria-label={`编辑 ${shipment.orderNo}`} title="编辑订单" onClick={(event) => { event.stopPropagation(); openEditShipment(shipment); }}>编辑</button><button className="archive-row-button" type="button" disabled={archivingOrderNo === shipment.orderNo} aria-label={`${shipment.archivedAt ? "恢复" : "归档"} ${shipment.orderNo}`} title={shipment.archivedAt ? "恢复到当前船次" : "归档船次"} onClick={(event) => { event.stopPropagation(); void setShipmentArchived(shipment, !shipment.archivedAt); }}>{archivingOrderNo === shipment.orderNo ? "处理中" : shipment.archivedAt ? "恢复" : "归档"}</button></span></td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={8}><div className="empty-state"><span>{showArchived ? "□" : "⌕"}</span><strong>{showArchived ? "还没有归档船次" : "没有找到匹配订单"}</strong><p>{showArchived ? "归档后的订单会保留船期历史并显示在这里。" : "试试其他搜索词或状态。"}</p></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="panel-footer"><span>显示 {filtered.length} / {showArchived ? summary.archived : summary.total} 票</span><span>{showArchived ? "归档不会删除船期变化记录" : "订单号相同时，再次导入会更新原记录"}</span></div>
          </div>

        </section>

        <section className="carrier-network" id="carriers">
          <div className="carrier-network-heading">
            <div><p className="eyebrow">查询网络</p><h2>船公司查询网络</h2></div>
            <p>系统优先使用箱号、船名航次和港口信息查询；无法判断船公司时，再联网交叉识别。这里只显示当前真正可用的查询能力。</p>
          </div>
          <div className="network-capability-summary">
            <div><strong>{automaticCarrierCount}</strong><span>个自动查询源</span><small>一键更新全部订单</small></div>
            <div><strong>已启用</strong><span>未知船公司识别</span><small>船名、航次和航线交叉查证</small></div>
            <div><strong>持续保存</strong><span>ETD / ETA 变化</span><small>直到最终 ATD / ATA</small></div>
          </div>
          <div className="source-network-grid">
            <div><span className="source-dot ready" /><p><strong>Evergreen ShipmentLink</strong><small>箱号运输节点</small></p><b>自动</b></div>
            <div><span className="source-dot ready" /><p><strong>Maersk</strong><small>船名航次 + POL/POD</small></p><b>自动</b></div>
            <div><span className="source-dot ready" /><p><strong>PANCON</strong><small>船名航次 + POL/POD</small></p><b>自动</b></div>
            <div><span className="source-dot ready" /><p><strong>COSCO eLines</strong><small>全球官网船期</small></p><b>自动</b></div>
            <div><span className="source-dot ready" /><p><strong>ONE</strong><small>全球官网船期</small></p><b>自动</b></div>
            <div><span className="source-dot ready" /><p><strong>HMM</strong><small>全球官网船期</small></p><b>自动</b></div>
            <div><span className="source-dot ready" /><p><strong>Yang Ming</strong><small>当前及相邻航次</small></p><b>自动</b></div>
            <div><span className="source-dot pending" /><p><strong>CMA CGM</strong><small>官方接口需要 KeyId</small></p><b className="needs-auth">需授权</b></div>
            <div><span className="source-dot pending" /><p><strong>Hapag-Lloyd</strong><small>官方接口需要 Client ID / Secret</small></p><b className="needs-auth">需授权</b></div>
            <div><span className="source-dot pending" /><p><strong>ZIM</strong><small>官方接口需要 OAuth</small></p><b className="needs-auth">需授权</b></div>
            <div><span className="source-dot pending" /><p><strong>MSC</strong><small>开发者接口需要订阅授权</small></p><b className="needs-auth">需授权</b></div>
          </div>
          <div className="network-lower-row">
            <div className="route-coverage"><strong>常用航线覆盖</strong><div><span>韩国</span><span>阿联酋</span><span>南美</span><span>墨西哥</span><span>加拿大</span><span>委内瑞拉</span><span>法国</span></div></div>
            <div className="network-tip" id="help"><strong>提高查询成功率</strong><p>优先填写集装箱号；没有箱号时，补充船名、航次、启运港和目的港。</p></div>
          </div>
          <div className="query-priority"><span>1</span><p><strong>箱号 / 船东提单 / Booking</strong><small>最快且最准确</small></p><i /><span>2</span><p><strong>船名航次 + POL/POD</strong><small>窄范围船期</small></p><i /><span>3</span><p><strong>当月船期回退</strong><small>仅在前两步无结果时</small></p></div>
        </section>
      </section>

      {(modal === "add" || modal === "edit") && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section className="modal-card add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><p className="eyebrow">{modal === "edit" ? "修改现有记录" : "手工录入"}</p><h2 id="add-title">{modal === "edit" ? "编辑订单信息" : "新增一票订单"}</h2></div><button type="button" onClick={() => setModal(null)} aria-label="关闭">×</button></div>
            <form onSubmit={saveShipment}>
              <div className="form-grid">
                <label><span>订单号 <b>*</b></span><input required value={draft.orderNo} onChange={(e) => updateDraft("orderNo", e.target.value)} placeholder="例如 226GRD0390" /></label>
                <label><span>客户编号</span><input value={draft.customerCode} onChange={(e) => updateDraft("customerCode", e.target.value)} placeholder="可选" /></label>
                <label><span>船名</span><input value={draft.vesselName} onChange={(e) => updateDraft("vesselName", e.target.value)} placeholder="TAMPA TRIUMPH" /></label>
                <label><span>航次</span><input value={draft.voyage} onChange={(e) => updateDraft("voyage", e.target.value)} placeholder="0789-043E" /></label>
                <label><span>提单号</span><input value={draft.billOfLading} onChange={(e) => updateDraft("billOfLading", e.target.value)} /></label>
                <label><span>Booking No.</span><input value={draft.bookingNo} onChange={(e) => updateDraft("bookingNo", e.target.value)} /></label>
                <label className="wide"><span>船公司</span><select value={draft.source} onChange={(e) => updateDraft("source", e.target.value)}><option value="手工录入">自动识别</option>{draft.source !== "手工录入" && !carriers.some((carrier) => carrier.shortName === draft.source) && <option value={draft.source}>{draft.source}</option>}<optgroup label="船公司">{carriers.map((carrier) => <option key={carrier.id} value={carrier.shortName}>{carrier.shortName}</option>)}</optgroup></select></label>
                <label className="wide"><span>集装箱号</span><input value={draft.containerNo} onChange={(e) => updateDraft("containerNo", e.target.value)} placeholder="有箱号时优先填写" /></label>
                <label><span>起运港</span><input value={draft.portOfLoading} onChange={(e) => updateDraft("portOfLoading", e.target.value)} placeholder="SHANGHAI" /></label>
                <label><span>目的港</span><input value={draft.portOfDischarge} onChange={(e) => updateDraft("portOfDischarge", e.target.value)} placeholder="INCHON" /></label>
                <label><span>计划开船 ETD</span><input type="date" value={draft.etd} onChange={(e) => updateDraft("etd", e.target.value)} /></label>
                <label><span>预计到港 ETA</span><input type="date" value={draft.eta} onChange={(e) => updateDraft("eta", e.target.value)} /></label>
                <label className="wide"><span>备注</span><textarea value={draft.notes} onChange={(e) => updateDraft("notes", e.target.value)} placeholder="可记录客户要求、中转说明或其他需要关注的信息" /></label>
              </div>
              <div className="form-hint"><span>ℹ</span><p>{modal === "edit" ? "修改订单号或查询信息不会删除原有船期变化记录；修改船名、航次、提单号、箱号或港口后，建议重新查询一次。" : "建议优先填写箱号；如果不知道船公司，保持“自动识别”即可，系统会在本地规则无法判断时联网查询。"}</p></div>
              <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={saving} type="submit">{saving ? "保存中…" : modal === "edit" ? "保存修改" : "保存订单"}</button></div>
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
            <div className="drawer-heading"><div><p className="eyebrow">订单详情</p><h2 id="detail-title">{selected.orderNo}</h2></div><div className="drawer-heading-actions"><button className="drawer-edit-button" type="button" onClick={() => openEditShipment(selected)}>编辑订单</button><button className="drawer-archive-button" type="button" disabled={Boolean(archivingOrderNo)} onClick={() => void setShipmentArchived(selected, !selected.archivedAt)}>{selected.archivedAt ? "恢复" : "归档"}</button><button className="drawer-close-button" type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></div></div>
            <div className="drawer-status"><span className={selected.archivedAt ? "status archived" : statusClass(selected.status)}>{selected.archivedAt ? "已归档" : selected.status}</span><small>{selected.archivedAt ? `归档于 ${selected.archivedAt.slice(0, 10)}` : keyStrength(selected)}</small></div>
            <section className="route-visual">
              <div className="route-labels"><div><span>起运港</span><strong>{selected.portOfLoading || "待补充"}</strong></div><div><span>目的港</span><strong>{selected.portOfDischarge || "待补充"}</strong></div></div>
              <div className="route-track"><i className="route-progress" style={{ width: `${completion(selected)}%` }} /><span className="port-dot origin" /><span className="ship-dot" style={{ left: `calc(${completion(selected)}% - 14px)` }}>▲</span><span className="port-dot destination" /></div>
              <p>{routeLabel(selected)}</p>
            </section>
            <div className="date-grid">
              <div className="date-comparison-card">
                <span>ETD / ATD</span>
                <div className="date-comparison-row"><small>初始 ETD</small><strong>{formatDate(selected.baselineEtd || selected.etd)}</strong></div>
                <div className="date-comparison-row"><small>{selected.atd ? "ATD 实际开船" : "当前 ETD"}</small><strong>{formatDate(selected.atd || selected.etd)}</strong>{(selected.atd || selected.etd) && (selected.baselineEtd || selected.etd) && <em className={scheduleShiftDays(selected.atd || selected.etd, selected.baselineEtd || selected.etd) > 0 ? "late" : "early"}>{shiftLabel(scheduleShiftDays(selected.atd || selected.etd, selected.baselineEtd || selected.etd), "晚开")}</em>}</div>
              </div>
              <div className="date-comparison-card">
                <span>ETA / ATA</span>
                <div className="date-comparison-row"><small>初始 ETA</small><strong>{formatDate(selected.baselineEta || selected.eta)}</strong></div>
                <div className="date-comparison-row"><small>{selected.ata ? "ATA 实际到港" : "当前 ETA"}</small><strong>{formatDate(selected.ata || selected.eta)}</strong>{(selected.ata || selected.eta) && (selected.baselineEta || selected.eta) && <em className={scheduleShiftDays(selected.ata || selected.eta, selected.baselineEta || selected.eta) > 0 ? "late" : "early"}>{shiftLabel(scheduleShiftDays(selected.ata || selected.eta, selected.baselineEta || selected.eta), selected.ata ? "晚到" : "延后")}</em>}</div>
              </div>
            </div>
            <section className="detail-section"><h3>运输标识</h3><dl><div><dt>船名 / 航次</dt><dd>{selected.vesselName || "—"} {selected.voyage}</dd></div><div><dt>集装箱号</dt><dd>{selected.containerNo || "—"}</dd></div><div><dt>提单号</dt><dd>{selected.billOfLading || "—"}</dd></div><div><dt>Booking No.</dt><dd>{selected.bookingNo || "—"}</dd></div></dl></section>
            <section className="detail-section timeline"><h3>当前跟踪摘要</h3><div className="timeline-item done"><i /><div><strong>订单已建立</strong><small>{selected.createdAt?.slice(0, 10)}</small></div></div>{(selected.atd || selected.etd) && <div className="timeline-item done"><i /><div><strong>{selected.atd ? "已开船" : "已有计划开船时间"}</strong><small>{formatDate(selected.atd || selected.etd)}</small></div></div>}<div className={`timeline-item ${selected.status === "已到港" ? "done" : "current"}`}><i /><div><strong>{selected.status}</strong><small>{selected.notes || "等待更多节点"}</small></div></div>{selected.eta && <div className={`timeline-item ${selected.ata ? "done" : "future"}`}><i /><div><strong>{selected.ata ? "已到达目的港" : "预计到达"}</strong><small>{formatDate(selected.ata || selected.eta)}</small></div></div>}</section>
            <section className="detail-section schedule-history">
              <div className="schedule-history-heading"><h3>船期变化记录</h3><span>{selected.scheduleHistory?.length ?? 0} 条记录</span></div>
              {selected.scheduleHistory?.length ? (
                <div className="schedule-history-list">
                  {selected.scheduleHistory.map((entry, index) => {
                    const previous = selected.scheduleHistory[index + 1];
                    const etdShift = entry.atd
                      ? scheduleShiftDays(entry.atd, previous?.etd || entry.etd)
                      : scheduleShiftDays(entry.etd, previous?.etd);
                    const etaShift = entry.ata
                      ? scheduleShiftDays(entry.ata, previous?.eta || entry.eta)
                      : scheduleShiftDays(entry.eta, previous?.eta);
                    return (
                      <article className={`schedule-history-entry ${entry.atd ? "actual" : etdShift > 0 ? "delayed" : ""}`} key={entry.id}>
                        <div className="schedule-history-time"><i /><strong>{entry.source === "初始船期" ? `${formatDate(entry.checkedAt)} 初始计划` : formatCheckedAt(entry.checkedAt)}</strong><small>{entry.source || "船公司官网"}</small></div>
                        <div className="schedule-history-dates">
                          <div><span>{entry.atd ? "ATD 实际开船" : "ETD 计划开船"}</span><strong>{formatDate(entry.atd || entry.etd)}</strong>{etdShift !== 0 && <small className={etdShift > 0 ? "late" : "early"}>{shiftLabel(etdShift, entry.atd ? "晚开" : "延后")}</small>}</div>
                          <div><span>{entry.ata ? "ATA 实际到港" : "ETA 预计到港"}</span><strong>{formatDate(entry.ata || entry.eta)}</strong>{etaShift !== 0 && <small className={etaShift > 0 ? "late" : "early"}>{shiftLabel(etaShift, entry.ata ? "晚到" : "延后")}</small>}</div>
                        </div>
                        {previous?.etd && entry.etd !== previous.etd && <p>ETD 从 {formatDate(previous.etd)} 调整为 {formatDate(entry.etd)}</p>}
                        {entry.atd && <p>最终实际开船：{formatDate(entry.atd)}{previous?.etd ? `（初始 / 上次 ETD：${formatDate(previous.etd)}）` : entry.etd ? `（官网最后 ETD：${formatDate(entry.etd)}）` : ""}</p>}
                      </article>
                    );
                  })}
                </div>
              ) : <p className="schedule-history-empty">下一次成功查询船公司官网后，将从这里开始保存每次 ETD、ETA 和最终 ATD/ATA。</p>}
            </section>
            <section className="source-detail"><span className="source-dot ready" /><div><strong>{selected.source}</strong><small>{selected.lastCheckedAt ? `最后记录：${selected.lastCheckedAt}` : "等待首次查询"}</small></div>{shipmentSourceUrl(selected) && <a href={shipmentSourceUrl(selected)} target="_blank" rel="noreferrer">打开官网 ↗</a>}</section>
          </aside>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
