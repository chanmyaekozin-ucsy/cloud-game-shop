import type { GameTag, Package } from "@/lib/types";

export type GameField = {
  key: "gameUserId" | "zoneId";
  label: string;
  placeholder: string;
  numeric?: boolean;
};

export type GameAccount = {
  gameUserId: string;
  zoneId: string;
  nickname: string;
  country: string;
  region: string;
};

export type GameModule = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  tag: GameTag;
  isActive: boolean;
  sortOrder: number;
  needsVerify: boolean;
  packageLabel: string;
  fields: GameField[];
  packages: Package[];
  verify: (input: { gameUserId: string; zoneId: string }) => Promise<GameAccount>;
};
