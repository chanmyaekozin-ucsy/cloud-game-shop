import type { GameField } from "@/games/shared/types";

export type Role = "user" | "admin";
export type GameTag = "hot" | "promo" | null;
export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "processing"
  | "success"
  | "failed"
  | "cancelled";
export type TxnStatus = "pending" | "succeeded" | "failed";

export type User = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: Role;
  pinHash: string;
  balanceKs: number;
  wathanpaySub?: string;
  avatarUrl?: string | null;
  twoFactorSecret?: string | null;
  twoFactorEnabled?: boolean;
  tokenVersion?: number;
  lastUsedTotpCounter?: number;
};

export type Game = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  tag: GameTag;
  isActive: boolean;
  sortOrder: number;
  needsVerify: boolean;
  idLabel: string;
  zoneLabel: string;
  packageLabel: string;
  fields: GameField[];
};

export type Package = {
  id: string;
  gameId: string;
  name: string;
  displayName: string;
  priceKs: number;
  offPercent: number;
  offKs: number;
  smileGoodsId: string;
  smileCoin: number;
  featured: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type Order = {
  id: string;
  userId: string;
  gameId: string;
  gameName: string;
  packageId: string;
  packageName: string;
  amountKs: number;
  gameUserId: string;
  zoneId: string;
  nickname: string;
  region: string;
  status: OrderStatus;
  paymentMethod: string;
  depositId: string | null;
  payeeName: string | null;
  payeePhone: string | null;
  qrPngBase64?: string | null;
  qrPayload?: string | null;
  txid: string | null;
  failReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type Transaction = {
  id: string;
  orderId: string;
  userId: string;
  amountKs: number;
  method: string;
  txid: string | null;
  status: TxnStatus;
  note: string;
  createdAt: string;
};

export type Store = {
  users: User[];
  games: Game[];
  packages: Package[];
  orders: Order[];
  transactions: Transaction[];
};

export type Session = {
  sub: string;
  role: Role;
  name: string;
};
