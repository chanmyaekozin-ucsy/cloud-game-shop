import type { GameModule } from "../shared/types";
import { FREEFIRE_ID, packages } from "./packages";
import { verify } from "./verify";

export const freefire: GameModule = {
  id: FREEFIRE_ID,
  slug: "free-fire",
  name: "Free Fire",
  icon: "/games/freefire/icon.png",
  tag: "promo",
  isActive: false,
  sortOrder: 1,
  needsVerify: true,
  packageLabel: "Diamonds",
  fields: [
    { key: "gameUserId", label: "Player ID", placeholder: "1234567890", numeric: true },
  ],
  packages,
  verify,
};
