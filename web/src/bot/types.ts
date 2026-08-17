export type BotLanguage = "my" | "en";

export type BotStep =
  | "idle"
  | "select_game"
  | "select_package"
  | "enter_game_id"
  | "confirm_account"
  | "choose_payment"
  | "awaiting_payment"
  | "awaiting_last5";

export type SavedAccount = {
  gameId: string;
  gameUserId: string;
  zoneId: string;
  nickname: string;
  savedAt: string;
};

export type BotSession = {
  telegramId: number;
  chatId: number;
  language: BotLanguage;
  step: BotStep;
  gameId?: string;
  packageId?: string;
  gameUserId?: string;
  zoneId?: string;
  nickname?: string;
  region?: string;
  pendingOrderId?: string;
  depositId?: string;
  payMethod?: string;
  amountKs?: number;
  savedAccounts: SavedAccount[];
  updatedAt: string;
};
