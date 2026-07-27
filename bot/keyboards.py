"""Reply and inline keyboards."""

from __future__ import annotations

from telegram import (
    CopyTextButton,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from bot import i18n


def main_menu_keyboard(lang: str | None = None) -> ReplyKeyboardMarkup:
    code = i18n.normalize_lang(lang)
    rows = [
        [
            KeyboardButton(i18n.menu_label("plans", code)),
            KeyboardButton(i18n.menu_label("history", code)),
        ],
        [
            KeyboardButton(i18n.menu_label("admin", code)),
            KeyboardButton(i18n.language_switch_label(code)),
        ],
    ]
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


def plans_inline(plans: list[dict], lang: str | None = None) -> InlineKeyboardMarkup:
    buttons = []
    for p in plans:
        pid = p.get("id")
        name = p.get("package_name", "Plan")
        price = _display_price(p.get("price", ""), lang)
        buttons.append(
            [InlineKeyboardButton(f"{name} — {price}", callback_data=f"plan:{pid}")]
        )
    buttons.append(
        [InlineKeyboardButton(i18n.t("back", lang), callback_data="menu:back")]
    )
    return InlineKeyboardMarkup(buttons)


def confirm_keyboard(lang: str | None = None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    f"✅ {i18n.t('confirm', lang)}",
                    callback_data="order:confirm",
                ),
                InlineKeyboardButton(
                    f"❌ {i18n.t('cancel', lang)}",
                    callback_data="order:cancel",
                ),
            ]
        ]
    )


def save_game_id_keyboard(order_id: int, lang: str | None = None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    i18n.t("save_game_id_yes", lang),
                    callback_data=f"saveacc:yes:{order_id}",
                ),
                InlineKeyboardButton(
                    i18n.t("save_game_id_no", lang),
                    callback_data="saveacc:no",
                ),
            ]
        ]
    )


def saved_game_accounts_keyboard(
    accounts: list[dict], lang: str | None = None
) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    for acct in accounts[:8]:
        game_id = str(acct.get("game_id") or "")
        server_id = str(acct.get("server_id") or "")
        nickname = str(acct.get("nickname") or "").strip()
        label = f"{game_id}({server_id})"
        if nickname:
            label = f"{label} · {nickname}"
        if len(label) > 64:
            label = label[:61] + "…"
        rows.append(
            [
                InlineKeyboardButton(
                    label,
                    callback_data=f"savedacc:{int(acct['id'])}",
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                i18n.t("new_server_id", lang),
                callback_data="savedacc:new",
            )
        ]
    )
    rows.append(
        [InlineKeyboardButton(i18n.t("back", lang), callback_data="menu:back")]
    )
    return InlineKeyboardMarkup(rows)


def kbz_copy_phone_keyboard(phone: str, lang: str | None = None) -> InlineKeyboardMarkup:
    rows = []
    if phone:
        rows.append(
            [
                InlineKeyboardButton(
                    i18n.t("copy_phone", lang),
                    copy_text=CopyTextButton(text=phone),
                )
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                f"❌ {i18n.t('cancel', lang)}",
                callback_data="order:cancel",
            )
        ]
    )
    return InlineKeyboardMarkup(rows)


def payment_method_keyboard(
    lang: str | None = None, *, methods: list[str] | None = None
) -> InlineKeyboardMarkup:
    allowed = methods or ["KBZPay", "WavePay"]
    row: list[InlineKeyboardButton] = []
    if "KBZPay" in allowed:
        row.append(InlineKeyboardButton("KBZPay", callback_data="pay:kbz"))
    if "WavePay" in allowed:
        row.append(InlineKeyboardButton("WavePay", callback_data="pay:wave"))
    rows: list[list[InlineKeyboardButton]] = [row] if row else []
    rows.append(
        [
            InlineKeyboardButton(
                f"❌ {i18n.t('cancel', lang)}",
                callback_data="order:cancel",
            )
        ]
    )
    return InlineKeyboardMarkup(rows)


def admin_contact_keyboard(lang: str | None = None) -> InlineKeyboardMarkup | None:
    from bot import config

    url = config.admin_contact_url()
    if not url:
        return None
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    i18n.t("admin_contact_button", lang),
                    url=url,
                )
            ]
        ]
    )


def failure_contact_markup(lang: str | None = None):
    """Inline Admin button on payment/top-up failures; fallback to main menu."""
    return admin_contact_keyboard(lang) or main_menu_keyboard(lang)


def group_proof_actions(order_id: int) -> InlineKeyboardMarkup:
    """Accept / Decline on proofs-group posts when KBZ auto-verify is unavailable."""
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "Accept", callback_data=f"proof_ok_{order_id}"
                ),
                InlineKeyboardButton(
                    "Decline", callback_data=f"proof_no_{order_id}"
                ),
            ],
        ]
    )


def admin_menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("👤 Users"), KeyboardButton("📦 Packages")],
            [KeyboardButton("📢 Notify")],
            [KeyboardButton("🚪 Exit Admin")],
        ],
        resize_keyboard=True,
    )


def admin_packages_inline() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("⚡ Auto CSV", callback_data="admin:pkg:auto")],
            [InlineKeyboardButton("📥 Import CSV", callback_data="admin:pkg:import")],
            [InlineKeyboardButton("📋 View list", callback_data="admin:pkg:view")],
            [InlineKeyboardButton("◀️ Back", callback_data="admin:back")],
        ]
    )


def admin_broadcast_confirm_inline() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ Send to all", callback_data="admin:broadcast:send"),
                InlineKeyboardButton("❌ Cancel", callback_data="admin:broadcast:cancel"),
            ]
        ]
    )


def _display_price(raw: str, lang: str | None = None) -> str:
    s = str(raw or "").strip()
    if s.upper().endswith("MMK"):
        s = s[:-3].strip()
    if s and not s.lower().endswith("ks"):
        return i18n.format_amount(int(s.replace(",", "")), lang)
    return s or "—"
