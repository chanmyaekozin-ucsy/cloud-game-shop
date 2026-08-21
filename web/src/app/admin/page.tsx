"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DashboardStats } from "@/app/api/admin/stats/route";

function formatKs(amount: number): string {
  return (
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(amount) + " Ks"
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    label: string;
    revenue: number;
    orders: number;
  } | null>(null);

  const loadStats = useCallback(async (selectedRange: "7d" | "30d" | "90d") => {
    setLoading(true);
    setError("");
    try {
      const data = await api<DashboardStats>(`/api/admin/stats?range=${selectedRange}`);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats(range);
  }, [range, loadStats]);

  // Chart coordinate calculations for high-resolution interactive SVG
  const chartMetrics = useMemo(() => {
    if (!stats || !stats.chartData || stats.chartData.length === 0) {
      return null;
    }
    const data = stats.chartData;
    const maxRev = Math.max(...data.map((d) => d.revenueKs), 1000);
    const maxOrders = Math.max(...data.map((d) => d.orderCount), 1);

    const width = 720;
    const height = 240;
    const padX = 40;
    const padY = 25;
    const graphW = width - padX * 2;
    const graphH = height - padY * 2;

    const points = data.map((d, i) => {
      const x = padX + (i / Math.max(data.length - 1, 1)) * graphW;
      const y = height - padY - (d.revenueKs / maxRev) * graphH;
      return { x, y, data: d };
    });

    let pathD = "";
    if (points.length > 0) {
      pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        // Smooth curve
        const prev = points[i - 1];
        const curr = points[i];
        const midX = (prev.x + curr.x) / 2;
        pathD += ` C ${midX} ${prev.y}, ${midX} ${curr.y}, ${curr.x} ${curr.y}`;
      }
    }

    const areaD =
      points.length > 0
        ? `${pathD} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${height - padY} Z`
        : "";

    return { width, height, padX, padY, maxRev, maxOrders, points, pathD, areaD };
  }, [stats]);

  if (loading && !stats) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-2)" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p>Loading sales dashboard...</p>
      </div>
    );
  }

  const s = stats?.summary;

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Dashboard</h2>
          <p>Sales tracking, payment methods breakdown, and real-time shop performance.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div className="dash-pills">
            <button
              type="button"
              className={`dash-pill ${range === "7d" ? "active" : ""}`}
              onClick={() => setRange("7d")}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`dash-pill ${range === "30d" ? "active" : ""}`}
              onClick={() => setRange("30d")}
            >
              30 Days
            </button>
            <button
              type="button"
              className={`dash-pill ${range === "90d" ? "active" : ""}`}
              onClick={() => setRange("90d")}
            >
              90 Days
            </button>
          </div>
          <button
            type="button"
            className="btn-sec"
            style={{ padding: "6px 12px", fontSize: "13px" }}
            onClick={() => void loadStats(range)}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="err" style={{ marginBottom: 16 }}>{error}</p> : null}

      {/* Primary KPI Metrics */}
      <div className="dash-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">Gross Sales Revenue</span>
          <span className="dash-kpi-val">{s ? formatKs(s.totalRevenueKs) : "0 Ks"}</span>
          <div className="dash-kpi-sub">
            <span>Today: <b>{s ? formatKs(s.todayRevenueKs) : "0 Ks"}</b></span>
            <span>·</span>
            <span>7d: <b>{s ? formatKs(s.weekRevenueKs) : "0 Ks"}</b></span>
          </div>
        </div>

        <div className="dash-kpi">
          <span className="dash-kpi-label">Completed Orders</span>
          <span className="dash-kpi-val">{s ? s.completedOrders : 0}</span>
          <div className="dash-kpi-sub">
            <span>Total processed: <b>{s ? s.totalOrders : 0}</b></span>
            <span>·</span>
            <span>Today: <b>{s ? s.todayOrders : 0}</b></span>
          </div>
        </div>

        <div className="dash-kpi">
          <span className="dash-kpi-label">Fulfillment Success Rate</span>
          <span className="dash-kpi-val" style={{ color: "#0f7f4e" }}>
            {s ? s.successRate : 100}%
          </span>
          <div className="dash-kpi-sub">
            <span>Average Order: <b>{s ? formatKs(s.averageOrderValueKs) : "0 Ks"}</b></span>
          </div>
        </div>

        <div className="dash-kpi">
          <span className="dash-kpi-label">Active / Review Queue</span>
          <span
            className="dash-kpi-val"
            style={{ color: s && (s.processingOrders > 0 || s.awaitingPaymentOrders > 0) ? "#b06000" : "var(--navy)" }}
          >
            {s ? s.processingOrders + s.awaitingPaymentOrders : 0}
          </span>
          <div className="dash-kpi-sub">
            <span>{s?.processingOrders || 0} processing</span>
            <span>·</span>
            <span>{s?.awaitingPaymentOrders || 0} unpaid</span>
          </div>
        </div>
      </div>

      {/* Main Chart & Payment Methods Grid */}
      <div className="dash-grid-2">
        {/* Sales Trend Chart */}
        <div className="dash-card">
          <div className="dash-card-head">
            <div>
              <div className="dash-card-title">Revenue & Order Volume Trend</div>
              <div className="dash-card-subtitle">Daily sales progression over selected timeframe</div>
            </div>
          </div>

          {chartMetrics && chartMetrics.points.length > 0 ? (
            <div style={{ position: "relative", width: "100%", height: "240px" }}>
              <svg
                viewBox={`0 0 ${chartMetrics.width} ${chartMetrics.height}`}
                style={{ width: "100%", height: "100%", overflow: "visible" }}
              >
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16a085" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#16a085" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                  const y = chartMetrics.padY + ratio * (chartMetrics.height - chartMetrics.padY * 2);
                  const revVal = Math.round(chartMetrics.maxRev * (1 - ratio));
                  return (
                    <g key={idx}>
                      <line
                        x1={chartMetrics.padX}
                        y1={y}
                        x2={chartMetrics.width - chartMetrics.padX}
                        y2={y}
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={chartMetrics.padX - 8}
                        y={y + 4}
                        textAnchor="end"
                        fontSize="10"
                        fill="var(--text-2)"
                      >
                        {revVal >= 1000000 ? `${(revVal / 1000000).toFixed(1)}M` : `${Math.round(revVal / 1000)}k`}
                      </text>
                    </g>
                  );
                })}

                {/* Filled Area */}
                <path d={chartMetrics.areaD} fill="url(#revGrad)" />

                {/* Line */}
                <path
                  d={chartMetrics.pathD}
                  fill="none"
                  stroke="#16a085"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Interactive Points */}
                {chartMetrics.points.map((pt, idx) => {
                  const isHovered = hoveredPoint?.label === pt.data.label;
                  return (
                    <g
                      key={idx}
                      onMouseEnter={() =>
                        setHoveredPoint({
                          x: pt.x,
                          y: pt.y,
                          label: pt.data.label,
                          revenue: pt.data.revenueKs,
                          orders: pt.data.orderCount,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? 6 : 3.5}
                        fill={isHovered ? "#102a43" : "#16a085"}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      {/* X-axis date labels */}
                      {idx % Math.ceil(chartMetrics.points.length / 7) === 0 ? (
                        <text
                          x={pt.x}
                          y={chartMetrics.height - 6}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--text-2)"
                        >
                          {pt.data.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>

              {/* Tooltip */}
              {hoveredPoint ? (
                <div
                  style={{
                    position: "absolute",
                    left: `${(hoveredPoint.x / chartMetrics.width) * 100}%`,
                    top: `${(hoveredPoint.y / chartMetrics.height) * 100}%`,
                    transform: "translate(-50%, -120%)",
                    background: "var(--navy)",
                    color: "#ffffff",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "600",
                    pointerEvents: "none",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                    whiteSpace: "nowrap",
                    zIndex: 10,
                  }}
                >
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "10px" }}>
                    {hoveredPoint.label}
                  </div>
                  <div>{formatKs(hoveredPoint.revenue)}</div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.8)" }}>
                    {hoveredPoint.orders} orders
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-2)" }}>
              No sales recorded for this timeframe.
            </div>
          )}
        </div>

        {/* Payment Channels Distribution */}
        <div className="dash-card">
          <div className="dash-card-head">
            <div>
              <div className="dash-card-title">Payment Methods</div>
              <div className="dash-card-subtitle">Volume via KBZPay, WavePay, WathanPay</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {stats && stats.paymentMethods.length > 0 ? (
              stats.paymentMethods.map((pm) => {
                const isKpay = pm.method.toLowerCase().includes("kbz");
                const isWave = pm.method.toLowerCase().includes("wave");
                const isWathan = pm.method.toLowerCase().includes("wathan");
                const barColor = isKpay ? "#1a73e8" : isWave ? "#fbbc04" : isWathan ? "#16a085" : "#627386";

                return (
                  <div key={pm.method} className="dash-progress-row">
                    <div className="dash-progress-header">
                      <span>{pm.method}</span>
                      <span>
                        <b>{formatKs(pm.revenueKs)}</b>{" "}
                        <span style={{ color: "var(--text-2)", fontWeight: "400", fontSize: "11px" }}>
                          ({pm.percentage}%)
                        </span>
                      </span>
                    </div>
                    <div className="dash-progress-track">
                      <div
                        className="dash-progress-bar"
                        style={{ width: `${Math.min(100, Math.max(4, pm.percentage))}%`, background: barColor }}
                      />
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-2)" }}>
                      {pm.orderCount} transaction{pm.orderCount === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: "var(--text-2)", padding: "16px 0" }}>No completed transactions.</div>
            )}
          </div>
        </div>
      </div>

      {/* Order Status & Top Products Grid */}
      <div className="dash-grid-even">
        {/* Order Status Matrix */}
        <div className="dash-card">
          <div className="dash-card-head">
            <div>
              <div className="dash-card-title">Order Status Distribution</div>
              <div className="dash-card-subtitle">Fulfillment breakdown across all orders</div>
            </div>
          </div>

          {stats?.statusBreakdown ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="dash-progress-row">
                <div className="dash-progress-header">
                  <span className="status-badge badge-success">Successful Top-ups</span>
                  <span>
                    <b>{stats.statusBreakdown.success.count}</b>{" "}
                    <span style={{ color: "var(--text-2)", fontSize: "11px" }}>
                      ({stats.statusBreakdown.success.percentage}%)
                    </span>
                  </span>
                </div>
                <div className="dash-progress-track">
                  <div
                    className="dash-progress-bar"
                    style={{
                      width: `${stats.statusBreakdown.success.percentage}%`,
                      background: "#0f7f4e",
                    }}
                  />
                </div>
              </div>

              <div className="dash-progress-row">
                <div className="dash-progress-header">
                  <span className="status-badge badge-processing">Processing / Manual Delivery</span>
                  <span>
                    <b>{stats.statusBreakdown.processing.count}</b>{" "}
                    <span style={{ color: "var(--text-2)", fontSize: "11px" }}>
                      ({stats.statusBreakdown.processing.percentage}%)
                    </span>
                  </span>
                </div>
                <div className="dash-progress-track">
                  <div
                    className="dash-progress-bar"
                    style={{
                      width: `${stats.statusBreakdown.processing.percentage}%`,
                      background: "#1a73e8",
                    }}
                  />
                </div>
              </div>

              <div className="dash-progress-row">
                <div className="dash-progress-header">
                  <span className="status-badge badge-warning">Awaiting Customer Payment</span>
                  <span>
                    <b>{stats.statusBreakdown.awaiting_payment.count}</b>{" "}
                    <span style={{ color: "var(--text-2)", fontSize: "11px" }}>
                      ({stats.statusBreakdown.awaiting_payment.percentage}%)
                    </span>
                  </span>
                </div>
                <div className="dash-progress-track">
                  <div
                    className="dash-progress-bar"
                    style={{
                      width: `${stats.statusBreakdown.awaiting_payment.percentage}%`,
                      background: "#b06000",
                    }}
                  />
                </div>
              </div>

              <div className="dash-progress-row">
                <div className="dash-progress-header">
                  <span className="status-badge badge-danger">Failed Transactions</span>
                  <span>
                    <b>{stats.statusBreakdown.failed.count}</b>{" "}
                    <span style={{ color: "var(--text-2)", fontSize: "11px" }}>
                      ({stats.statusBreakdown.failed.percentage}%)
                    </span>
                  </span>
                </div>
                <div className="dash-progress-track">
                  <div
                    className="dash-progress-bar"
                    style={{
                      width: `${stats.statusBreakdown.failed.percentage}%`,
                      background: "#c5221f",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Top Selling Games */}
        <div className="dash-card">
          <div className="dash-card-head">
            <div>
              <div className="dash-card-title">Top Revenue Games</div>
              <div className="dash-card-subtitle">Highest grossing titles in shop</div>
            </div>
            <Link
              href="/admin/games"
              style={{ fontSize: "12px", color: "var(--brand-dark)", fontWeight: "600" }}
            >
              Manage Games
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {stats && stats.topGames.length > 0 ? (
              stats.topGames.map((game, idx) => (
                <div key={game.id} className="rank-item">
                  <div className="rank-game">
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-2)", width: "16px" }}>
                      {idx + 1}
                    </span>
                    <img src={game.icon} alt="" className="rank-icon" />
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "650", color: "var(--navy)" }}>
                        {game.name}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-2)" }}>
                        {game.orderCount} order{game.orderCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--navy)" }}>
                      {formatKs(game.revenueKs)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--text-2)", padding: "16px 0" }}>No game sales yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Orders Live Table */}
      <div className="dash-card" style={{ marginBottom: "24px" }}>
        <div className="dash-card-head">
          <div>
            <div className="dash-card-title">Recent Sales Stream</div>
            <div className="dash-card-subtitle">Latest customer purchases and payment status</div>
          </div>
          <Link
            href="/admin/purchases"
            style={{ fontSize: "12px", color: "var(--brand-dark)", fontWeight: "600" }}
          >
            View All Purchases
          </Link>
        </div>

        <div className="table-wrap" style={{ border: "none" }}>
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Game & Package</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {stats && stats.recentOrders.length > 0 ? (
                stats.recentOrders.map((order) => {
                  let badgeClass = "badge-neutral";
                  if (order.status === "success" || order.status === "paid") badgeClass = "badge-success";
                  else if (order.status === "processing") badgeClass = "badge-processing";
                  else if (order.status === "awaiting_payment") badgeClass = "badge-warning";
                  else if (order.status === "failed") badgeClass = "badge-danger";

                  return (
                    <tr key={order.id}>
                      <td>
                        <span style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: "600" }}>
                          {order.id}
                        </span>
                      </td>
                      <td>
                        <b>{order.gameName}</b>
                        <div style={{ fontSize: "12px", color: "var(--text-2)" }}>
                          {order.packageName}
                        </div>
                      </td>
                      <td>
                        <b>{formatKs(order.amountKs)}</b>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px", fontWeight: "600" }}>
                          {order.paymentMethod || "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${badgeClass}`}>
                          {order.status.replace("_", " ")}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--text-2)" }}>
                        {formatDate(order.createdAt)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--text-2)", padding: "24px" }}>
                    No recent orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
