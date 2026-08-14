#!/usr/bin/env python3
"""Generate MLBB price list poster."""

from __future__ import annotations

import argparse
import base64
import csv
import html
import re
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BG_PATH = ROOT / "assets" / "chun-li.jpg"
LOGO_PATH = ROOT / "assets" / "cloud-gameshop-logo.png"
FONT_PATH = ROOT / "assets" / "A09_Khit-Normal.ttf"
OUTPUT_PATH = ROOT / "assets" / "mlbb-price-list-poster.png"
CSV_PATH = ROOT / "data" / "Untitled spreadsheet - Sheet2 (2).csv"

TELEGRAM_BOT_USERNAME = "@cloud_gameshop_bot"
BURMESE_LINE_1 = "အခုလွှဲ အခုရောက်"
BURMESE_LINE_2_PREFIX = "စိတ်ချရတဲ့ "
BURMESE_LINE_2_ACCENT = "CLOUD"
TITLE_TEXT = "စိန်စျေးနှုန်းများ"

FEATURED_NAMES = ("Weekly Pass", "Twilight Pass")

ORIENTATIONS = {
    "portrait": (1280, 1280),
    "landscape": (1920, 1080),
}


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


def _format_price(price_mmk: str) -> str:
    digits = re.sub(r"[^\d]", "", price_mmk.strip())
    if not digits:
        raise ValueError(f"Invalid price_mmk: {price_mmk!r}")
    return f"{int(digits):,} Kyats"


def _display_name(name: str) -> str:
    match = re.match(r"^Diamond×(\d+)\s*\+(\d+)$", name)
    if match:
        return f"{match.group(1)}+{match.group(2)}"
    return name


def load_packages_from_csv(
    csv_path: Path,
) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Return (grid_packages, featured_packages) from CSV."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    by_name: dict[str, tuple[str, str]] = {}
    grid: list[tuple[str, str]] = []
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            name = (row.get("package_name") or "").strip()
            price_raw = (row.get("price_mmk") or "").strip()
            if not name or not price_raw:
                continue
            item = (name, _format_price(price_raw))
            by_name[name] = item
            if name not in FEATURED_NAMES:
                grid.append(item)

    featured: list[tuple[str, str]] = []
    for featured_name in FEATURED_NAMES:
        if featured_name not in by_name:
            raise ValueError(f"Missing featured package in CSV: {featured_name}")
        featured.append(by_name[featured_name])

    if not grid:
        raise ValueError(f"No packages found in CSV: {csv_path}")
    return grid, featured


def _price_html(price: str) -> str:
    amount, _, unit = price.partition(" ")
    return f"""
                  <span class="price">
                    <span class="price-inner">
                      <span class="price-amount">{_esc(amount)}</span>
                      <span class="price-unit">{_esc(unit)}</span>
                    </span>
                  </span>
                """


def _item_html(name: str, price: str, extra_class: str = "") -> str:
    label = _display_name(name)
    classes = "item"
    if extra_class:
        classes += f" {extra_class}"
    return f"""
                <div class="{classes}">
                  <span class="name">{_esc(label)}</span>
                  {_price_html(price)}
                </div>
                """


def _package_rows(
    packages: list[tuple[str, str]],
    featured: list[tuple[str, str]],
    columns: int,
) -> str:
    rows: list[str] = []
    for idx in range(0, len(packages), columns):
        cells = []
        for name, price in packages[idx : idx + columns]:
            cells.append(_item_html(name, price))
        rows.append(f'<div class="row">{"".join(cells)}</div>')
    featured_html = "".join(
        _item_html(name, price, "featured") for name, price in featured
    )
    return f"""
    <div class="grid">{"".join(rows)}</div>
    <div class="featured-wrap">{featured_html}</div>
    """


def _data_url(path: Path) -> str:
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
    }.get(path.suffix.lower(), "application/octet-stream")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _tagline_html() -> str:
    return f"""
      <div class="tagline">
        <div class="tagline-line">{_esc(BURMESE_LINE_1)}</div>
        <div class="tagline-line">{_esc(BURMESE_LINE_2_PREFIX)}<span class="accent">{_esc(BURMESE_LINE_2_ACCENT)}</span></div>
      </div>
    """


def _portrait_header_html(logo_url: str) -> str:
    return f"""
    <div class="header">
      <img class="logo" src="{logo_url}" alt="Cloud Game Shop" />
      {_tagline_html()}
    </div>
    <div class="main-title">{_esc(TITLE_TEXT)}</div>
"""


def _landscape_header_html(logo_url: str) -> str:
    return f"""
    <div class="header">
      <div class="brand">
        <img class="logo" src="{logo_url}" alt="Cloud Game Shop" />
        <div class="title-block">
          <div class="title">{_esc(TITLE_TEXT)}</div>
          <div class="bot">{_esc(TELEGRAM_BOT_USERNAME)}</div>
        </div>
      </div>
      {_tagline_html()}
    </div>
"""


def _styles(orientation: str) -> str:
    if orientation == "portrait":
        return """
    .poster { padding: 20px 24px 14px; }

    .header {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }

    .logo {
      width: 140px;
      height: 140px;
      border-radius: 32px;
    }

    .tagline { text-align: right; }

    .tagline-line { font-size: 60px; line-height: 1.12; }
    .accent { font-size: 40px; }

    .main-title {
      display: block;
      text-align: center;
      font-size: 100px;
      line-height: 1.05;
      color: #ffffff;
      margin: 12px 0 10px;
      letter-spacing: 0.01em;
    }

    .content { margin: 0 0 6px; }

    .list {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
      min-height: 0;
    }

    .grid {
      gap: 6px;
      flex: 0 1 auto;
    }

    .row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 8px;
    }

    .item {
      padding: 7px 10px;
      gap: 8px;
      border-radius: 10px;
      background: rgba(6, 14, 28, 0.9);
      border: 1px solid rgba(0, 212, 255, 0.2);
    }

    .featured-wrap {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 18px;
      padding-top: 4px;
    }

    .item.featured {
      padding: 10px 14px;
      border-color: rgba(0, 212, 255, 0.35);
    }

    .item.featured .name { font-size: 32px; }
    .item.featured .price {
      width: 350px;
      min-width: 350px;
      min-height: 52px;
    }
    .item.featured .price-amount { font-size: 52px; }
    .item.featured .price-unit { font-size: 28px; }

    .name { font-size: 38px; line-height: 1.05; }
    .price {
      padding: 9px 8px 7px;
      width: 250px;
      min-width: 250px;
      min-height: 48px;
    }
    .price-amount { font-size: 50px; }
    .price-unit { font-size: 28px; }

    .footer { font-size: 20px; padding-top: 2px; }
    .footer strong { font-size: 27px; }
"""
    return """
    .poster { padding: 20px 44px 16px; }
    .main-title { display: none; }

    .header {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      gap: 32px;
      padding-bottom: 4px;
    }

    .brand {
      flex-direction: row;
      align-items: center;
      gap: 16px;
    }

    .logo {
      width: 72px;
      height: 72px;
      border-radius: 14px;
    }

    .title { font-size: 30px; }
    .bot { font-size: 18px; margin-top: 4px; }
    .tagline { text-align: right; }
    .tagline-line { font-size: 24px; }
    .accent { font-size: 26px; }

    .content { margin: 10px 0 8px; }
    .list { gap: 10px; }
    .grid { gap: 8px; }

    .row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 12px;
    }

    .item {
      padding: 10px 12px;
      gap: 18px;
      border-radius: 12px;
      background: rgba(6, 14, 28, 0.9);
      border: 1px solid rgba(0, 212, 255, 0.2);
    }

    .item.featured {
      padding: 12px 16px;
    }

    .item.featured .name { font-size: 36px; }
    .item.featured .price {
      width: 300px;
      min-width: 300px;
      min-height: 58px;
    }
    .item.featured .price-amount { font-size: 40px; }
    .item.featured .price-unit { font-size: 24px; }

    .featured-wrap {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 20px;
      padding-top: 4px;
    }

    .name { font-size: 34px; }
    .price {
      padding: 10px 8px 8px;
      width: 300px;
      min-width: 300px;
      min-height: 54px;
    }
    .price-amount { font-size: 38px; }
    .price-unit { font-size: 22px; }

    .footer { font-size: 15px; }
    .footer strong { font-size: 16px; }
"""


def build_html(
    orientation: str,
    packages: list[tuple[str, str]],
    featured: list[tuple[str, str]],
) -> str:
    canvas_w, canvas_h = ORIENTATIONS[orientation]
    font_url = _data_url(FONT_PATH)
    bg_url = _data_url(BG_PATH)
    logo_url = _data_url(LOGO_PATH)
    orientation_styles = _styles(orientation)
    header_html = (
        _portrait_header_html(logo_url)
        if orientation == "portrait"
        else _landscape_header_html(logo_url)
    )

    return f"""<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="utf-8" />
  <style>
    @font-face {{
      font-family: "Khit";
      src: url("{font_url}") format("truetype");
      font-weight: normal;
      font-style: normal;
    }}

    * {{ box-sizing: border-box; margin: 0; padding: 0; }}

    body {{
      width: {canvas_w}px;
      height: {canvas_h}px;
      overflow: hidden;
      font-family: "Khit", sans-serif;
      color: #ffffff;
      background: #060e1c;
    }}

    .poster {{
      position: relative;
      display: flex;
      flex-direction: column;
      width: {canvas_w}px;
      height: {canvas_h}px;
      background: url("{bg_url}") center / cover no-repeat;
    }}

    .poster::before {{
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(4, 10, 22, 0.78);
      pointer-events: none;
    }}

    .header, .main-title, .content, .footer {{
      position: relative;
      z-index: 1;
    }}

    .header {{ display: flex; flex-shrink: 0; }}
    .brand {{ display: flex; min-width: 0; }}

    .logo {{
      object-fit: cover;
      display: block;
      flex-shrink: 0;
      opacity: 0.95;
    }}

    .title-block {{ min-width: 0; }}
    .title {{ line-height: 1.1; color: rgba(255, 255, 255, 0.92); white-space: nowrap; }}
    .bot {{ color: rgba(0, 212, 255, 0.9); white-space: nowrap; }}

    .tagline {{ flex-shrink: 0; color: rgba(255, 255, 255, 0.9); }}
    .tagline-line {{ white-space: nowrap; }}
    .tagline-line + .tagline-line {{ margin-top: 4px; }}
    .accent {{ color: #00d4ff; }}

    .content {{
      flex: 1;
      display: flex;
      align-items: stretch;
      min-height: 0;
    }}

    .list {{
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      width: 100%;
    }}

    .grid {{
      display: flex;
      flex-direction: column;
    }}

    .row {{ display: grid; align-items: stretch; }}

    .item {{
      display: flex;
      align-items: center;
      justify-content: space-between;
    }}

    .name {{
      color: #ffffff;
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transform: translateY(3px);
    }}

    .price {{
      color: #ffffff;
      background: rgba(0, 212, 255, 0.5);
      border-radius: 8px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      box-sizing: border-box;
    }}

    .price-inner {{
      display: inline-flex;
      align-items: baseline;
      justify-content: center;
      gap: 7px;
      transform: translateY(3px);
      line-height: 1;
    }}

    .price-amount {{
      color: #ffffff;
      letter-spacing: 0.01em;
    }}

    .price-unit {{
      color: rgba(255, 255, 255, 0.92);
      letter-spacing: 0.02em;
    }}

    .footer {{
      flex-shrink: 0;
      text-align: center;
      color: rgba(180, 195, 210, 0.75);
      letter-spacing: 0.02em;
    }}

    .footer strong {{ color: rgba(255, 255, 255, 0.82); font-weight: normal; }}
    .footer .bot-footer {{ color: rgba(0, 212, 255, 0.85); }}

    {orientation_styles}
  </style>
</head>
<body>
  <div class="poster">
    {header_html}

    <div class="content">
      <div class="list">
        {_package_rows(packages, featured, 2)}
      </div>
    </div>

    <div class="footer">
      <strong>Cloud Game Shop</strong>
      &nbsp;·&nbsp; Premium MLBB Top-Up &nbsp;·&nbsp;
      <span class="bot-footer">{_esc(TELEGRAM_BOT_USERNAME)}</span>
    </div>
  </div>
</body>
</html>
"""


def build_poster(
    orientation: str,
    packages: list[tuple[str, str]],
    featured: list[tuple[str, str]],
) -> Image.Image:
    canvas_w, canvas_h = ORIENTATIONS[orientation]
    html_doc = build_html(orientation, packages, featured)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": canvas_w, "height": canvas_h})
        page.set_content(html_doc, wait_until="networkidle")
        page.wait_for_timeout(300)
        png_bytes = page.screenshot(type="png", full_page=False)
        browser.close()
    return Image.open(__import__("io").BytesIO(png_bytes)).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate MLBB price list poster.")
    parser.add_argument(
        "--orientation",
        choices=("portrait", "landscape"),
        default="portrait",
        help="Poster orientation (default: portrait)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=CSV_PATH,
        help=f"Package CSV path (default: {CSV_PATH})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output image path (default: assets/mlbb-price-list-poster.png)",
    )
    args = parser.parse_args()

    if not BG_PATH.exists():
        raise FileNotFoundError(f"Background not found: {BG_PATH}")
    if not FONT_PATH.exists():
        raise FileNotFoundError(f"Font not found: {FONT_PATH}")

    packages, featured = load_packages_from_csv(args.csv)
    output_path = args.output or OUTPUT_PATH
    poster = build_poster(args.orientation, packages, featured)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    poster.save(output_path, format="PNG", optimize=True)
    print(f"Saved: {output_path} ({args.orientation})")
    print(f"Source: {args.csv}")
    print(f"Packages: {len(packages)} grid + {len(featured)} featured")


if __name__ == "__main__":
    main()
