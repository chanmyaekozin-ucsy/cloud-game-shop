import type { Game } from "@/lib/types";
import { freefire } from "../freefire/freefire";
import { mlbb } from "../mlbb/mlbb";
import { pubg } from "../pubg/pubg";
import type { GameModule } from "./types";

export const GAME_MODULES: GameModule[] = [mlbb, pubg, freefire];

export function getGame(slug: string) {
  return GAME_MODULES.find((game) => game.slug === slug);
}

export function getGameById(id: string) {
  return GAME_MODULES.find((game) => game.id === id);
}

export function toGameRecord(mod: GameModule): Game {
  return {
    id: mod.id,
    name: mod.name,
    slug: mod.slug,
    icon: mod.icon,
    tag: mod.tag,
    isActive: mod.isActive,
    sortOrder: mod.sortOrder,
    needsVerify: mod.needsVerify,
    idLabel: mod.fields[0]?.label ?? "ID",
    zoneLabel: mod.fields[1]?.label ?? "",
    packageLabel: mod.packageLabel,
    fields: mod.fields,
  };
}
