import type { BotLanguage } from "./types";

export const DEFAULT_LANG: BotLanguage = "my";

export const TEXTS = {
  welcome: {
    en: "*Welcome to Cloud Game Shop*\n\nSelect an option below to buy game packages or top up instantly.",
    my: "*Cloud Game Shop မှ ကြိုဆိုပါသည်*\n\nဂိမ်း Diamonds နှင့် ပစ္စည်းများ ဝယ်ယူရန် အောက်ပါ Menu မှ ရွေးချယ်ပေးပါ။",
  },
  choose_game: {
    en: "*Select a Game:*",
    my: "*ဝယ်ယူလိုသော ဂိမ်းကို ရွေးချယ်ပါ:*",
  },
  choose_package: {
    en: "*Select Package for {game}:*",
    my: "*{game} အတွက် ဝယ်ယူလိုသော Package ကို ရွေးချယ်ပါ:*",
  },
  enter_game_id: {
    en: "*Enter Game ID & Zone/Server:*\n\nFormat: `{format}`\nExample: `{example}`",
    my: "*Game ID နှင့် Server/Zone ကို ပို့ပေးပါ:*\n\nပုံစံ: `{format}`\nဥပမာ: `{example}`",
  },
  invalid_game_id: {
    en: "Invalid format. Please enter Game ID and Server like:\n`{example}`",
    my: "ပုံစံမမှန်ကန်ပါ။ ကျေးဇူးပြု၍ ဤပုံစံအတိုင်း ပို့ပေးပါ:\n`{example}`",
  },
  checking_account: {
    en: "Verifying game account...",
    my: "Game အကောင့်ကို စစ်ဆေးနေပါသည်...",
  },
  account_verified: {
    en: "*Account Verified*\n\nNickname: *{nickname}*\nGame ID: `{gameUserId}` ({zoneId})\nRegion: {region}\n\nPackage: *{packageName}*\nTotal: *{amountKs}*\n\nProceed to payment?",
    my: "*အကောင့်စစ်ဆေးမှု အောင်မြင်ပါသည်*\n\nနာမည်: *{nickname}*\nGame ID: `{gameUserId}` ({zoneId})\nRegion: {region}\n\nPackage: *{packageName}*\nကျသင့်ငွေ: *{amountKs}*\n\nငွေပေးချေမှုသို့ ဆက်သွားမလား?",
  },
  choose_payment: {
    en: "*Choose Payment Method:*",
    my: "*ငွေပေးချေမည့် နည်းလမ်းကို ရွေးချယ်ပါ:*",
  },
  payment_instructions: {
    en: "*Payment Instructions ({method})*\n\nAmount: *{amountKs}*\nAccount Name: *{accountName}*\nAccount / Number: `{accountNumber}`\n\n*Steps:*\n1. Transfer the exact amount (*{amountKs}*).\n2. Send the **last 5 digits** of the Transaction ID here.\n\nOrder ID: `{orderId}`",
    my: "*ငွေပေးချေရန် လမ်းညွှန်ချက် ({method})*\n\nကျသင့်ငွေ: *{amountKs}*\nလက်ခံသူ: *{accountName}*\nဖုန်းနံပါတ်/အကောင့်: `{accountNumber}`\n\n*လုပ်ဆောင်ရန်:*\n1. ကျသင့်ငွေ *{amountKs}* တိကျစွာ လွှဲပေးပါ။\n2. လွှဲပြီးပါက လုပ်ငန်းစဉ်နံပါတ် (TxID) ၏ **နောက်ဆုံး ၅ လုံး** ကို ဤနေရာသို့ ပို့ပေးပါ။\n\nOrder ID: `{orderId}`",
  },
  checking_payment: {
    en: "Verifying transaction with payment gateway...",
    my: "ငွေလွှဲပြေစာကို စစ်ဆေးနေပါသည်...",
  },
  payment_success: {
    en: "*Top-up Successful*\n\nYour diamonds have been delivered.\n\nPlayer: *{nickname}*\nGame: *{gameName}*\nItem: *{packageName}*\nOrder ID: `{orderId}`\nTxID: `{txid}`\n\nThank you for choosing Cloud Game Shop.",
    my: "*စိန်ထည့်သွင်းမှု အောင်မြင်ပါသည်*\n\nလူကြီးမင်း၏ ဂိမ်းအကောင့်ထဲသို့ ပစ္စည်းများ အောင်မြင်စွာ ဖြည့်သွင်းပြီးပါပြီ။\n\nနာမည်: *{nickname}*\nဂိမ်း: *{gameName}*\nပစ္စည်း: *{packageName}*\nOrder ID: `{orderId}`\nTxID: `{txid}`\n\nCloud Game Shop ကို အသုံးပြုသည့်အတွက် ကျေးဇူးတင်ပါသည်။",
  },
  payment_paid_topup_pending: {
    en: "*Payment Confirmed*\n\n*Delivery Notice:* Automated supplier top-up encountered an issue (Session/System). Our Admin has received your order and will manually fulfill your diamonds shortly.\n\nPlayer: *{nickname}*\nGame: *{gameName}*\nItem: *{packageName}*\nOrder ID: `{orderId}`\nTxID: `{txid}`\n\nNeed assistance? Tap /help to contact support.",
    my: "*ငွေပေးချေမှု အောင်မြင်စွာ လက်ခံရရှိပါသည်*\n\n*အသိပေးချက်:* Supplier Session/စနစ် အခက်အခဲကြောင့် ဂိမ်းထဲသို့ စိန်ကို အလိုအလျောက် ထည့်သွင်း၍ မရသေးပါ။\n\nလူကြီးမင်း၏ Order ကို Admin မှ လက်ခံရရှိထားပြီး မကြာမီ စစ်ဆေးကာ ဂိမ်းထဲသို့ ကိုယ်တိုင် ထည့်သွင်းပေးပါမည်။\n\nနာမည်: *{nickname}*\nဂိမ်း: *{gameName}*\nပစ္စည်း: *{packageName}*\nOrder ID: `{orderId}`\nTxID: `{txid}`\n\nအကူအညီ လိုအပ်ပါက /help ဖြင့် ဆက်သွယ်နိုင်ပါသည်။",
  },
  payment_failed: {
    en: "*Payment Verification Failed*\n\n{reason}\n\nPlease check the last 5 digits and try again, or tap /help to contact support.",
    my: "*ငွေပေးချေမှု မအောင်မြင်ပါ*\n\n{reason}\n\nနောက်ဆုံး ၅ လုံးကို ပြန်လည်စစ်ဆေးပြီး ပို့ပေးပါ သို့မဟုတ် /help ဖြင့် အကူအညီရယူပါ။",
  },
  order_cancelled: {
    en: "Order cancelled. Tap /start to begin a new order.",
    my: "Order ကို ပယ်ဖျက်လိုက်ပါပြီ။ အသစ်စတင်ရန် /start ကို နှိပ်ပါ။",
  },
  no_open_order: {
    en: "No active order found. Tap /start to begin.",
    my: "လက်ရှိ မှာယူမှု မရှိပါ။ /start ကို နှိပ်ပြီး စတင်ပါ။",
  },
  help: {
    en: "*Cloud Game Shop Support*\n\nNeed assistance or manual topup review?\nPlease contact our support team:\nTelegram: @cloudgameshop_admin\nWebsite: https://cloudgameshop.flash-myanmar.com",
    my: "*Cloud Game Shop အကူအညီ*\n\nအကူအညီ လိုအပ်ပါက သို့မဟုတ် မေးမြန်းလိုပါက:\nTelegram: @cloudgameshop_admin\nWebsite: https://cloudgameshop.flash-myanmar.com သို့ ဆက်သွယ်နိုင်ပါသည်။",
  },
  history_empty: {
    en: "You have no order history yet.",
    my: "လူကြီးမင်းတွင် မှာယူမှု မှတ်တမ်း မရှိသေးပါ။",
  },
  history_item: {
    en: "• `{orderId}` | {game} - {package} | {amount} | *{status}* ({date})",
    my: "• `{orderId}` | {game} - {package} | {amount} | *{status}* ({date})",
  },
  language_set: {
    en: "Language set to English.",
    my: "ဘာသာစကားကို မြန်မာဘာသာသို့ ပြောင်းလဲလိုက်ပါပြီ။",
  },
};

export function t(
  key: keyof typeof TEXTS,
  lang: BotLanguage = DEFAULT_LANG,
  params: Record<string, string | number> = {},
): string {
  const dict = TEXTS[key];
  let text = (dict && dict[lang]) || dict?.en || String(key);
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
