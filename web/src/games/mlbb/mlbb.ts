import type { GameModule } from "../shared/types";
import { MLBB_ID, packages } from "./packages";
import { verify } from "./verify";

export { MLBB_ID };

export const mlbb: GameModule = {
  id: MLBB_ID,
  slug: "mlbb",
  name: "Mobile Legends",
  icon: "/games/mlbb/icon.png",
  tag: "hot",
  isActive: true,
  sortOrder: 0,
  needsVerify: true,
  packageLabel: "Diamonds",
  fields: [
    { key: "gameUserId", label: "Game ID", placeholder: "450215964", numeric: true },
    { key: "zoneId", label: "Server", placeholder: "2353", numeric: true },
  ],
  packages,
  verify,
};
