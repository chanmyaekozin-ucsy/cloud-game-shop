import { NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";
import type { Order } from "@/lib/types";

export interface DashboardStats {
  summary: {
    totalRevenueKs: number;
    totalOrders: number;
    completedOrders: number;
    processingOrders: number;
    failedOrders: number;
    awaitingPaymentOrders: number;
    successRate: number;
    averageOrderValueKs: number;
    todayRevenueKs: number;
    todayOrders: number;
    weekRevenueKs: number;
    weekOrders: number;
    monthRevenueKs: number;
    monthOrders: number;
  };
  chartData: Array<{
    date: string;
    label: string;
    revenueKs: number;
    orderCount: number;
    successCount: number;
    failedCount: number;
  }>;
  paymentMethods: Array<{
    method: string;
    revenueKs: number;
    orderCount: number;
    percentage: number;
  }>;
  statusBreakdown: {
    success: { count: number; revenueKs: number; percentage: number };
    processing: { count: number; revenueKs: number; percentage: number };
    awaiting_payment: { count: number; revenueKs: number; percentage: number };
    failed: { count: number; revenueKs: number; percentage: number };
    cancelled: { count: number; revenueKs: number; percentage: number };
  };
  topGames: Array<{
    id: string;
    name: string;
    icon: string;
    orderCount: number;
    revenueKs: number;
  }>;
  recentOrders: Order[];
}

function normalizePaymentMethod(method: string): string {
  const m = (method || "").toLowerCase().trim();
  if (m.includes("kbz") || m.includes("kpay")) return "KBZPay";
  if (m.includes("wave")) return "WavePay";
  if (m.includes("wathan")) return "WathanPay";
  if (m.includes("cpay") || m.includes("cb")) return "CBPay";
  if (m.includes("aya")) return "AYAPay";
  if (!m) return "Direct / Unspecified";
  return method.trim();
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const range = req.nextUrl.searchParams.get("range") || "30d"; // 7d, 30d, 90d, all
    const store = await readStore();
    const orders = store.orders;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = startOfToday - 29 * 24 * 60 * 60 * 1000;

    let totalRevenueKs = 0;
    const totalOrders = orders.length;
    let completedOrders = 0;
    let processingOrders = 0;
    let failedOrders = 0;
    let awaitingPaymentOrders = 0;

    let todayRevenueKs = 0;
    let todayOrders = 0;
    let weekRevenueKs = 0;
    let weekOrders = 0;
    let monthRevenueKs = 0;
    let monthOrders = 0;

    const methodStats: Record<string, { revenueKs: number; orderCount: number }> = {
      KBZPay: { revenueKs: 0, orderCount: 0 },
      WavePay: { revenueKs: 0, orderCount: 0 },
      WathanPay: { revenueKs: 0, orderCount: 0 },
    };

    const statusTotals: Record<string, { count: number; revenueKs: number }> = {
      success: { count: 0, revenueKs: 0 },
      processing: { count: 0, revenueKs: 0 },
      awaiting_payment: { count: 0, revenueKs: 0 },
      failed: { count: 0, revenueKs: 0 },
      cancelled: { count: 0, revenueKs: 0 },
    };

    const gameStats: Record<string, { id: string; name: string; icon: string; orderCount: number; revenueKs: number }> = {};
    const gameMap = new Map(store.games.map((g) => [g.id, g]));

    // Determine days for trend chart based on range
    const chartDays = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const dailyBuckets = new Map<string, { date: string; label: string; revenueKs: number; orderCount: number; successCount: number; failedCount: number }>();

    for (let i = chartDays - 1; i >= 0; i--) {
      const d = new Date(startOfToday - i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dailyBuckets.set(iso, {
        date: iso,
        label,
        revenueKs: 0,
        orderCount: 0,
        successCount: 0,
        failedCount: 0,
      });
    }

    for (const order of orders) {
      const orderTime = Date.parse(order.createdAt);
      const isSuccess = order.status === "success" || order.status === "paid";
      const isProcessing = order.status === "processing";
      const isFailed = order.status === "failed";
      const isAwaiting = order.status === "awaiting_payment";
      const isCancelled = order.status === "cancelled";

      const amount = Number(order.amountKs) || 0;

      if (isSuccess || isProcessing) {
        totalRevenueKs += amount;
      }

      if (isSuccess) {
        completedOrders++;
        statusTotals.success.count++;
        statusTotals.success.revenueKs += amount;
      } else if (isProcessing) {
        processingOrders++;
        statusTotals.processing.count++;
        statusTotals.processing.revenueKs += amount;
      } else if (isAwaiting) {
        awaitingPaymentOrders++;
        statusTotals.awaiting_payment.count++;
        statusTotals.awaiting_payment.revenueKs += amount;
      } else if (isFailed) {
        failedOrders++;
        statusTotals.failed.count++;
        statusTotals.failed.revenueKs += amount;
      } else if (isCancelled) {
        statusTotals.cancelled.count++;
        statusTotals.cancelled.revenueKs += amount;
      }

      if (Number.isFinite(orderTime)) {
        if (orderTime >= startOfToday) {
          todayOrders++;
          if (isSuccess || isProcessing) todayRevenueKs += amount;
        }
        if (orderTime >= sevenDaysAgo) {
          weekOrders++;
          if (isSuccess || isProcessing) weekRevenueKs += amount;
        }
        if (orderTime >= thirtyDaysAgo) {
          monthOrders++;
          if (isSuccess || isProcessing) monthRevenueKs += amount;
        }

        const dateIso = new Date(orderTime).toISOString().slice(0, 10);
        const bucket = dailyBuckets.get(dateIso);
        if (bucket) {
          bucket.orderCount++;
          if (isSuccess || isProcessing) {
            bucket.revenueKs += amount;
            bucket.successCount++;
          } else if (isFailed || isCancelled) {
            bucket.failedCount++;
          }
        }
      }

      // Payment method breakdown
      if (isSuccess || isProcessing) {
        const normMethod = normalizePaymentMethod(order.paymentMethod);
        if (!methodStats[normMethod]) {
          methodStats[normMethod] = { revenueKs: 0, orderCount: 0 };
        }
        methodStats[normMethod].revenueKs += amount;
        methodStats[normMethod].orderCount += 1;
      }

      // Top games breakdown
      if (isSuccess || isProcessing) {
        const gId = order.gameId || "other";
        if (!gameStats[gId]) {
          const found = gameMap.get(gId);
          gameStats[gId] = {
            id: gId,
            name: order.gameName || found?.name || gId,
            icon: found?.icon || "/logo.png",
            orderCount: 0,
            revenueKs: 0,
          };
        }
        gameStats[gId].orderCount++;
        gameStats[gId].revenueKs += amount;
      }
    }

    const validCompleted = completedOrders + processingOrders;
    const successRate = totalOrders > 0 ? Math.round((validCompleted / totalOrders) * 1000) / 10 : 100;
    const averageOrderValueKs = validCompleted > 0 ? Math.round(totalRevenueKs / validCompleted) : 0;

    const paymentMethodsList = Object.entries(methodStats)
      .map(([method, data]) => ({
        method,
        revenueKs: data.revenueKs,
        orderCount: data.orderCount,
        percentage: totalRevenueKs > 0 ? Math.round((data.revenueKs / totalRevenueKs) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.revenueKs - a.revenueKs);

    const calcStatus = (key: keyof typeof statusTotals) => ({
      count: statusTotals[key].count,
      revenueKs: statusTotals[key].revenueKs,
      percentage: totalOrders > 0 ? Math.round((statusTotals[key].count / totalOrders) * 1000) / 10 : 0,
    });

    const statusBreakdown = {
      success: calcStatus("success"),
      processing: calcStatus("processing"),
      awaiting_payment: calcStatus("awaiting_payment"),
      failed: calcStatus("failed"),
      cancelled: calcStatus("cancelled"),
    };

    const topGamesList = Object.values(gameStats)
      .sort((a, b) => b.revenueKs - a.revenueKs)
      .slice(0, 6);

    const recentOrders = [...orders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    const response: DashboardStats = {
      summary: {
        totalRevenueKs,
        totalOrders,
        completedOrders,
        processingOrders,
        failedOrders,
        awaitingPaymentOrders,
        successRate,
        averageOrderValueKs,
        todayRevenueKs,
        todayOrders,
        weekRevenueKs,
        weekOrders,
        monthRevenueKs,
        monthOrders,
      },
      chartData: Array.from(dailyBuckets.values()),
      paymentMethods: paymentMethodsList,
      statusBreakdown,
      topGames: topGamesList,
      recentOrders,
    };

    return Response.json(response);
  } catch (err) {
    return jsonError(err);
  }
}
