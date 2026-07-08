"""English and Myanmar bot copy."""

from __future__ import annotations

LANG_EN = "en"
LANG_MY = "my"
DEFAULT_LANG = LANG_MY

MENU_BUTTONS = {
    "plans": {LANG_EN: "View Prices", LANG_MY: "စျေးနှုန်းကြည့်မယ်"},
    "history": {LANG_EN: "History", LANG_MY: "မှတ်တမ်း"},
    "admin": {LANG_EN: "Admin", LANG_MY: "Admin"},
    "language": {LANG_EN: "Language", LANG_MY: "ဘာသာစကား"},
}

# Older reply keyboards may still show these labels until refreshed.
LEGACY_MENU_ALIASES: dict[str, str] = {
    "See Plans": "plans",
    "Help": "admin",
    "အကူအညီ": "admin",
}

LANG_LABELS = {
    LANG_EN: "English",
    LANG_MY: "မြန်မာဘာသာ",
}

_TEXTS: dict[str, dict[str, str]] = {
    "welcome": {
        LANG_EN: (
            "Hello.\n\n"
            "Welcome to Cloud Game Shop.\n\n"
            "Please select from the following menu to continue."
        ),
        LANG_MY: (
            "မင်္ဂလာပါ။\n"
            "Cloud Game Shop မှကြိုဆိုပါတယ်။\n\n"
            "ဆက်လက်လုပ်ဆောင်ရန် အောက်ပါ Menu များမှ ရွေးချယ်ပေးပါ။"
        ),
    },
    "choose_plan": {
        LANG_EN: "Select the package you wish to purchase.",
        LANG_MY: "ဝယ်ယူလိုသော Package ရွေးချယ်ပါ။",
    },
    "game_id_prompt": {
        LANG_EN: (
            "Please send your Game ID and Server exactly in this format.\n\n"
            "Example: 450215964(2353)\n\n"
            "It must be exactly in this format."
        ),
        LANG_MY: (
            "GameID နှင့် Server ကို ဒီပုံစံအတိုင်း အတိအကျပို့ပေးပါ။\n"
            "ဥပမာ - 450215964(2353)\n\n"
            "ဒီပုံစံအတိုင်း အတိအကျဖြစ်ရပါမယ်နော်"
        ),
    },
    "game_id_invalid": {
        LANG_EN: (
            "Please send your Game ID and Server exactly in this format.\n\n"
            "Example: 450215964(2353)\n\n"
            "It must be exactly in this format."
        ),
        LANG_MY: (
            "GameID နှင့် Server ကို ဒီပုံစံအတိုင်း အတိအကျပို့ပေးပါ။\n"
            "ဥပမာ - 450215964(2353)\n\n"
            "ဒီပုံစံအတိုင်း အတိအကျဖြစ်ရပါမယ်နော်"
        ),
    },
    "checking_account": {
        LANG_EN: "Checking the game account...",
        LANG_MY: "Game အကောင့်လေးကို စစ်ဆေးပေးနေပါတယ်။",
    },
    "confirm_account": {
        LANG_EN: "Confirm this account?",
        LANG_MY: "ဤအကောင့်ကို အတည်ပြုမလား?",
    },
    "kbz_pay": {
        LANG_EN: (
            "Please pay with KBZPay.\n\n"
            "Payment Amount: {amount}\n\n"
            "Receiver Name: {name}\n"
            "Transfer Number: {phone}\n\n"
            "After transferring the money, please send the last 5 digits "
            "of the transaction ID.\n\n"
            "See the image for an example."
        ),
        LANG_MY: (
            "KBZPay ဖြင့် ငွေပေးချေပါ။\n\n"
            "ပေးချရမည့် အမောင့် - {amount}\n\n"
            "ငွေလက်ခံသူအမည် - {name}\n"
            "လွှဲရမည့်နံပါတ် - {phone}\n\n"
            "လွှဲပြီးပါက လုပ်ငန်းစဥ်နံပါတ်ရဲ့ နောက်ဆုံး ဂဏန်း ၅ လုံးကိုပို့ပေးပါ။\n"
            "နမူနာ ကို ပုံတွင်ကြည့်ပါ။"
        ),
    },
    "tx_digits_prompt": {
        LANG_EN: "Please send the exact last 5 digits of the transaction ID.",
        LANG_MY: "လုပ်ငန်းစဥ်နံပါတ်ရဲ့ နောက်ဆုံးဂဏန်း ၅ လုံး အတိအကျပို့ပေးပါ။",
    },
    "tx_digits_invalid": {
        LANG_EN: "Please send the exact last 5 digits of the transaction ID.",
        LANG_MY: "လုပ်ငန်းစဥ်နံပါတ်ရဲ့ နောက်ဆုံးဂဏန်း ၅ လုံး အတိအကျပို့ပေးပါ။",
    },
    "checking_tx": {
        LANG_EN: "Checking the transaction...",
        LANG_MY: "ငွေလွှဲကို စစ်ဆေးနေပါတယ်။",
    },
    "payment_verified": {
        LANG_EN: "Payment successful.",
        LANG_MY: "ငွေပေးချေမှုအောင်မြင်ပါတယ်။",
    },
    "payment_failed": {
        LANG_EN: (
            "Payment was not successful.\n"
            "Please check again (or)\n"
            "Contact Admin."
        ),
        LANG_MY: (
            "ငွေပေးချေမှုမအောင်မြင်ပါ။\n"
            "ပြန်လည် စစ်ဆေးပါ (သို့မဟုတ်)\n"
            "Admin ကို ဆက်သွယ်ပါ။"
        ),
    },
    "tx_already_used": {
        LANG_EN: (
            "Payment was not successful.\n"
            "Please check again (or)\n"
            "Contact Admin."
        ),
        LANG_MY: (
            "ငွေပေးချေမှုမအောင်မြင်ပါ။\n"
            "ပြန်လည် စစ်ဆေးပါ (သို့မဟုတ်)\n"
            "Admin ကို ဆက်သွယ်ပါ။"
        ),
    },
    "use_menu": {
        LANG_EN: "Please select from the menu below.",
        LANG_MY: "အောက်ပါ Menu မှ ရွေးချယ်ပေးပါ။",
    },
    "no_plans": {
        LANG_EN: "No packages available yet.",
        LANG_MY: "Package များ မရှိသေးပါ။",
    },
    "plan_not_found": {
        LANG_EN: "Package not found.",
        LANG_MY: "Package မတွေ့ပါ။",
    },
    "session_expired": {
        LANG_EN: "Session expired. Please select View Prices again.",
        LANG_MY: "Session ကုန်သွားပါပြီ။ စျေးနှုန်းကြည့်မယ် ကို ပြန်ရွေးပါ။",
    },
    "order_not_found": {
        LANG_EN: "Order not found.",
        LANG_MY: "Order မတွေ့ပါ။",
    },
    "order_cancelled": {
        LANG_EN: "Order cancelled.",
        LANG_MY: "Order ကို ပယ်ဖျက်လိုက်ပါပြီ။",
    },
    "main_menu": {
        LANG_EN: "Main menu",
        LANG_MY: "ပင်မမီနူး",
    },
    "choose_language": {
        LANG_EN: "Choose your language:",
        LANG_MY: "ဘာသာစကား ရွေးချယ်ပါ:",
    },
    "language_set": {
        LANG_EN: "Language set to English.",
        LANG_MY: "ဘာသာစကားကို မြန်မာသို့ ပြောင်းလိုက်ပါပြီ။",
    },
    "admin": {
        LANG_EN: (
            "Contact Admin:\n"
            "{admin}\n\n"
            "Tap the button below to message Admin."
        ),
        LANG_MY: (
            "Admin ဆက်သွယ်ရန်:\n"
            "{admin}\n\n"
            "အောက်ပါ ခလုတ်ကို နှိပ်ပြီး Admin ကို စာပို့ပါ။"
        ),
    },
    "admin_contact_button": {
        LANG_EN: "Message Admin",
        LANG_MY: "Admin ကို စာပို့မယ်",
    },
    "no_orders": {
        LANG_EN: "No orders yet.",
        LANG_MY: "မှတ်တမ်း မရှိသေးပါ။",
    },
    "history_header": {
        LANG_EN: "Your recent orders:\n",
        LANG_MY: "မကြာသေးမီ မှာယူမှုများ:\n",
    },
    "topup_processing": {
        LANG_EN: "We are topping up your selected package.",
        LANG_MY: "သင်ရွေးချယ်ထားသော Package ကိုဖြည့်ပေးနေပါပြီ။",
    },
    "payment_ok": {
        LANG_EN: (
            "Top-up complete.\n"
            "Thank you very much for your purchase.\n"
            "Have a pleasant day."
        ),
        LANG_MY: (
            "ဖြည့်ပြီးပါပြီ။\n"
            "ဝယ်ယူအားပေးမှုအတွက် အထူးကျေးဇူးတင်ပါတယ်။\n"
            "သာယာသောနေ့လေးဖြစ်ပါစေခင်ဗျာ။"
        ),
    },
    "topup_failed": {
        LANG_EN: (
            "We could not complete your top-up.\n"
            "Please contact Admin.\n"
            "We sincerely apologize for the inconvenience."
        ),
        LANG_MY: (
            "ဖြည့်ပေးလို့မရပါဘူးဖြစ်နေပါတယ်။\n"
            "ကျေးဇူးပြုပြီး Admin ကိုဆက်သွယ်ပေးပါ။\n"
            "အဆင်အပြေမှုအတွက် အနူးအညွတ်တောင်းပန်ပါတယ်။"
        ),
    },
    "copy_phone": {
        LANG_EN: "Tap to copy number",
        LANG_MY: "နံပါတ်ကို နှိပ်ပြီး ကူးယူပါ",
    },
    "confirm": {
        LANG_EN: "Confirm",
        LANG_MY: "အတည်ပြု",
    },
    "cancel": {
        LANG_EN: "Cancel",
        LANG_MY: "ပယ်ဖျက်",
    },
    "back": {
        LANG_EN: "« Back",
        LANG_MY: "« နောက်သို့",
    },
    "tx_example_caption": {
        LANG_EN: "Eg - {example}",
        LANG_MY: "ဥပမာ - {example}",
    },
}


def normalize_lang(lang: str | None) -> str:
    if lang in (LANG_MY, "mm"):
        return LANG_MY
    if lang == LANG_EN:
        return LANG_EN
    return DEFAULT_LANG


def t(key: str, lang: str | None = None, **kwargs: object) -> str:
    code = normalize_lang(lang)
    template = _TEXTS.get(key, {}).get(code) or _TEXTS.get(key, {}).get(LANG_EN, key)
    if kwargs:
        return template.format(**kwargs)
    return template


def menu_label(button: str, lang: str | None = None) -> str:
    if button == "language":
        return language_switch_label(lang)
    return MENU_BUTTONS[button][normalize_lang(lang)]


def language_switch_label(lang: str | None = None) -> str:
    if normalize_lang(lang) == LANG_MY:
        return LANG_LABELS[LANG_EN]
    return LANG_LABELS[LANG_MY]


def alternate_lang(lang: str | None = None) -> str:
    if normalize_lang(lang) == LANG_MY:
        return LANG_EN
    return LANG_MY


def language_target_lang(text: str, current_lang: str | None = None) -> str | None:
    """Map a language button tap to the language the user wants."""
    stripped = text.strip()
    if stripped == LANG_LABELS[LANG_EN]:
        return LANG_EN
    if stripped == LANG_LABELS[LANG_MY]:
        return LANG_MY
    if stripped in MENU_BUTTONS["language"].values():
        return alternate_lang(current_lang)
    return None


def all_menu_labels() -> set[str]:
    labels: set[str] = set()
    for key, labels_by_lang in MENU_BUTTONS.items():
        if key == "language":
            continue
        labels.update(labels_by_lang.values())
    labels.add(LANG_LABELS[LANG_EN])
    labels.add(LANG_LABELS[LANG_MY])
    return labels


def menu_button_key(text: str) -> str | None:
    stripped = text.strip()
    if stripped in LEGACY_MENU_ALIASES:
        return LEGACY_MENU_ALIASES[stripped]
    if language_target_lang(stripped) is not None:
        return "language"
    for key, labels in MENU_BUTTONS.items():
        if key == "language":
            continue
        if stripped in labels.values():
            return key
    return None


def format_amount(amount_ks: int, lang: str | None = None) -> str:
    if normalize_lang(lang) == LANG_MY:
        return f"{amount_ks} Ks"
    return f"{amount_ks:,} Ks"
