"""Mobile Legends helpers: region check and merchant packages."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from providers.smileone.config import USER_AGENT
from providers.smileone.http import looks_like_login_page

DEFAULT_MLBB_VALIDASI_BASE = "https://htetgameshop.com/api/mlbb/validasi"
DEFAULT_MLBB_REGIONCHECK_REFERER = "https://htetgameshop.com/region-check"
DEFAULT_MLBB_MERCHANT_URL = "https://www.smile.one/merchant/mobilelegends"
DEFAULT_MLBB_MERCHANT_REFERER = "https://www.smile.one/br/"
DEFAULT_MLBB_CHECKROLE_URL = "https://www.smile.one/merchant/mobilelegends/checkrole"
DEFAULT_MLBB_QUERY_URL = "https://www.smile.one/merchant/mobilelegends/query"
DEFAULT_MLBB_PAY_URL = "https://www.smile.one/merchant/mobilelegends/pay"
DEFAULT_MLBB_CUSTOMER_URL = "https://www.smile.one/merchant/customer"
MLBB_PAY_METHOD = "smilecoin"

MLBB_REGION_MAP: dict[str, str] = {
    "Philippines": "SEA",
    "Malaysia": "SEA",
    "Singapore": "SEA",
    "Indonesia": "SEA",
    "Thailand": "SEA",
    "Vietnam": "SEA",
    "Myanmar": "SEA",
    "Cambodia": "SEA",
    "United States": "NA",
    "Canada": "NA",
    "Mexico": "NA",
    "Germany": "EU",
    "France": "EU",
    "United Kingdom": "EU",
    "Netherlands": "EU",
    "India": "IN",
    "Bangladesh": "IN",
    "Pakistan": "IN",
    "Brazil": "LATAM",
    "Argentina": "LATAM",
    "Chile": "LATAM",
    "Russia": "RU",
    "Kazakhstan": "RU",
    "Ukraine": "RU",
    "Japan": "JP",
    "South Korea": "KR",
    "China": "CN",
    "Australia": "OCE",
    "New Zealand": "OCE",
}

_MLBB_MERCHANT_LI_RE = re.compile(
    r'<li[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<em[^>]*>\s*([^<]*?)\s*</em>[\s\S]*?<h3[^>]*>([\s\S]*?)</h3>',
    re.IGNORECASE,
)


@dataclass
class MlbbAccount:
    game_id: str
    server_id: str
    nickname: str
    country: str
    region: str


@dataclass
class MlbbPackage:
    goods_id: str
    name: str
    brl: str
    smile_coin: str


def mlbb_merchant_url() -> str:
    return os.environ.get("SMILE_MLBB_MERCHANT_URL", DEFAULT_MLBB_MERCHANT_URL).strip()


def mlbb_merchant_referer() -> str:
    return os.environ.get("SMILE_MLBB_MERCHANT_REFERER", DEFAULT_MLBB_MERCHANT_REFERER).strip()


def mlbb_checkrole_url() -> str:
    return os.environ.get("SMILE_MLBB_CHECKROLE_URL", DEFAULT_MLBB_CHECKROLE_URL).strip()


def mlbb_query_url() -> str:
    return os.environ.get("SMILE_MLBB_QUERY_URL", DEFAULT_MLBB_QUERY_URL).strip()


def mlbb_pay_url() -> str:
    return os.environ.get("SMILE_MLBB_PAY_URL", DEFAULT_MLBB_PAY_URL).strip()


def mlbb_customer_url() -> str:
    return os.environ.get("SMILE_MLBB_CUSTOMER_URL", DEFAULT_MLBB_CUSTOMER_URL).strip()


def mlbb_pay_succeeded(*, final_url: str, html: str) -> bool:
    if "/message/success" in final_url:
        return True
    if looks_like_login_page(html, final_url=final_url):
        return False
    lowered = html.lower()
    if "message/success" in lowered or "pedido realizado" in lowered:
        return True
    return False


def mlbb_pay_error_message(html: str) -> str | None:
    m = re.search(r'class="errmeg"[^>]*>[\s\S]*?<span>([^<]+)</span>', html, re.IGNORECASE)
    if m:
        msg = re.sub(r"\s+", " ", m.group(1)).strip()
        if msg:
            return msg
    if looks_like_login_page(html):
        return "Smile.one session expired."
    return None


def mlbb_region_from_country(country: str) -> str:
    c = (country or "").strip()
    return MLBB_REGION_MAP.get(c, "Unknown") if c else "Unknown"


def fetch_mlbb_validasi(
    game_id: str,
    server_id: str,
    timeout_sec: int,
) -> tuple[dict | None, str | None]:
    base = os.environ.get("SMILE_MLBB_VALIDASI_URL", DEFAULT_MLBB_VALIDASI_BASE).rstrip("/")
    referer = os.environ.get("SMILE_MLBB_REGIONCHECK_REFERER", DEFAULT_MLBB_REGIONCHECK_REFERER)
    q = urllib.parse.urlencode({"id": game_id.strip(), "serverid": server_id.strip()})
    url = f"{base}?{q}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": referer,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            raw = resp.read().decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, f"Request failed: {e}"

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None, "Response was not JSON."
    return (data, None) if isinstance(data, dict) else (None, "Unexpected JSON shape.")


def parse_mlbb_account(game_id: str, server_id: str, data: dict) -> MlbbAccount | str:
    status = data.get("status")
    result = data.get("result")
    if status == "success" and isinstance(result, dict):
        country = str(result.get("country", "") or "").strip()
        nickname = str(result.get("nickname", "") or "").strip()
        if not country and not nickname:
            return "Account not found (empty profile)."
        return MlbbAccount(
            game_id=game_id,
            server_id=server_id,
            nickname=nickname,
            country=country,
            region=mlbb_region_from_country(country),
        )
    hint = data.get("message") or data.get("error") or status
    return f"Lookup failed: {hint}"


def extract_smile_mlbb_info_pricing(html: str) -> dict[str, object]:
    needle = "info = JSON.parse('"
    i = html.find(needle)
    if i == -1:
        return {}
    start = i + len(needle)
    end = html.find("');", start)
    if end == -1:
        return {}
    try:
        data = json.loads(html[start:end])
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def parse_mlbb_merchant_li_packages(html: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for m in _MLBB_MERCHANT_LI_RE.finditer(html):
        gid, brl, h3 = m.group(1), m.group(2).strip(), m.group(3)
        name = re.sub(r"<[^>]+>", " ", h3)
        name = re.sub(r"\s+", " ", name).strip()
        rows.append({"goods_id": gid, "brl": brl, "name": name})
    return rows


def smilecoin_price_for_goods(info: dict[str, object], goods_id: str) -> str:
    block = info.get(goods_id)
    if not isinstance(block, dict):
        return "(n/a)"
    sc = block.get("smilecoin")
    if not isinstance(sc, dict):
        return "(n/a)"
    # On Smile.one, total_amount holds the discounted (actual payable) price,
    # while discount_total holds the original pre-discount price.
    val = sc.get("total_amount") or sc.get("discount_total")
    if val is None or str(val).strip() == "":
        return "(n/a)"
    return str(val).strip()


def parse_mlbb_packages(html: str) -> list[MlbbPackage]:
    info = extract_smile_mlbb_info_pricing(html)
    packages: list[MlbbPackage] = []
    for row in parse_mlbb_merchant_li_packages(html):
        gid = row["goods_id"]
        packages.append(
            MlbbPackage(
                goods_id=gid,
                name=row["name"],
                brl=row["brl"],
                smile_coin=smilecoin_price_for_goods(info, gid),
            )
        )
    return packages
