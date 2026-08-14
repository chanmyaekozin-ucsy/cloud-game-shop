export function formatKs(n: number) {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-${abs} Ks` : `${abs} Ks`;
}

export function offPercentOf(pkg: { offPercent?: number }) {
  const n = Math.round(Number(pkg.offPercent) || 0);
  return Math.min(100, Math.max(0, n));
}

export function offKsOf(pkg: { offKs?: number }) {
  return Math.max(0, Math.round(Number(pkg.offKs) || 0));
}

export function salePriceKs(pkg: { priceKs: number; offPercent?: number; offKs?: number }) {
  const afterPct = Math.round((pkg.priceKs * (100 - offPercentOf(pkg))) / 100);
  return Math.max(0, afterPct - offKsOf(pkg));
}

export function hasDiscount(pkg: { priceKs: number; offPercent?: number; offKs?: number }) {
  return salePriceKs(pkg) < pkg.priceKs;
}

export function discountLabel(pkg: { offPercent?: number; offKs?: number }) {
  const parts: string[] = [];
  const pct = offPercentOf(pkg);
  const ks = offKsOf(pkg);
  if (pct) parts.push(`${pct}% off`);
  if (ks) parts.push(`-${formatKs(ks)}`);
  return parts.join(" · ");
}

export function displayPackageName(name: string) {
  const match = name.match(/^Diamond×(\d+)\s*\+(\d+)$/);
  if (match) return `${match[1]}+${match[2]}`;
  return name;
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function orderStatusLabel(status: string) {
  if (status === "success") return "Completed";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "processing") return "Processing";
  if (status === "paid") return "Paid";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return status;
}
