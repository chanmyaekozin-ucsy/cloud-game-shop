import type { GameModule } from "../shared/types";
import { PUBG_ID, packages } from "./packages";
import { verify } from "./verify";

export const pubg: GameModule = {
  id: PUBG_ID,
  slug: "pubg",
  name: "PUBG Mobile",
  icon: "/games/pubg/icon.png",
  tag: null,
  isActive: false,
  sortOrder: 2,
  needsVerify: true,
  packageLabel: "UC",
  fields: [
    { key: "gameUserId", label: "Player ID", placeholder: "5123456789", numeric: true },
  ],
  packages,
  verify,
};
