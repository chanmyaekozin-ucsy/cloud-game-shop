#!/usr/bin/env python3
"""Generate Cloud Game Shop sponsored mobile ad banners (no prices)."""

from __future__ import annotations

import argparse
import base64
import html
import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "sponsored-banners"
LOGO_PATH = ROOT / "assets" / "cloud-gameshop-logo.png"
FONT_PATH = ROOT / "assets" / "A09_Khit-Normal.ttf"

BACKGROUNDS = {
    "lunox": ROOT / "assets" / "lunox_bg.jpg",
    "cici": ROOT / "assets" / "cici_bg.png",
    "mlbb": ROOT / "assets" / "mlbb-bg.png",
}

SHOP_NAME = "Cloud Game Shop"
SLOGAN_LINE_1 = "အခုလွှဲ အခုရောက်"
SLOGAN_LINE_2_PREFIX = "စိတ်ချရတဲ့ "
SLOGAN_LINE_2_ACCENT = "CLOUD"
SLOGAN_INLINE = "အခုလွှဲ အခုရောက် · စိတ်ချရတဲ့ "
BOT_HANDLE = "@cloud_gameshop_bot"


@dataclass(frozen=True)
class BannerSpec:
    key: str
    width: int
    height: int
    design: str
    bg: str
    label: str


# Wide + short mobile ad sizes (2×–4× AdMob / AppLovin friendly)
BANNERS: list[BannerSpec] = [
    BannerSpec("wide-200-classic", 1600, 200, "classic", "lunox", "Ultra-wide classic"),
    BannerSpec("wide-180-split", 1600, 180, "split", "lunox", "Ultra-wide split"),
    BannerSpec("leader-180-glow", 1456, 180, "glow", "cici", "Leaderboard glow"),
    BannerSpec("wide-160-strip", 1440, 160, "strip", "mlbb", "Wide strip"),
    BannerSpec("wide-140-center", 1280, 140, "center", "lunox", "Center mark"),
    BannerSpec("phone-100-classic", 1280, 100, "classic", "cici", "Large banner 4×"),
    BannerSpec("phone-100-strip", 1280, 100, "strip", "lunox", "Large banner strip"),
    BannerSpec("phone-50-strip", 1280, 50, "micro", "mlbb", "Standard banner 4×"),
    BannerSpec("xl-220-glow", 1920, 220, "glow", "lunox", "XL glow"),
    BannerSpec("xl-200-split", 1920, 200, "split", "cici", "XL split"),
]


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


def _data_url(path: Path) -> str:
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ttf": "font/ttf",
    }.get(path.suffix.lower(), "application/octet-stream")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _scale(spec: BannerSpec) -> dict[str, float]:
    """Typography + spacing scaled to banner height (keeps text inside the frame)."""
    h = spec.height
    # Stacked layouts need smaller type; strip/micro stay on one row.
    if spec.design in ("strip", "micro"):
        name = max(13, h * 0.42)
        slogan = max(12, h * 0.34)
        handle = max(10, h * 0.28)
        pad_y = 0
    elif spec.design == "split":
        name = max(16, h * 0.38)
        slogan = max(14, h * 0.30)
        handle = max(10, h * 0.16)
        pad_y = max(8, h * 0.14)
    else:
        # classic / glow / center — leave room for name + slogan (+ handle)
        name = max(15, min(52, h * 0.26))
        slogan = max(13, min(40, h * 0.20))
        handle = max(10, min(24, h * 0.12))
        pad_y = max(8, h * 0.10)

    return {
        "pad_x": max(16, h * 0.28),
        "pad_y": pad_y,
        "gap": max(12, h * 0.18),
        "logo": max(34, h * 0.72),
        "logo_radius": max(7, h * 0.14),
        "name": name,
        "slogan": slogan,
        "handle": handle,
        "accent_bar": max(3, h * 0.05),
        "border": 2 if h >= 100 else 1,
    }


def _design_css(spec: BannerSpec, s: dict[str, float]) -> str:
    if spec.design == "classic":
        return f"""
    .banner {{
      display: flex;
      align-items: center;
      gap: {s["gap"]}px;
      padding: {s["pad_y"]}px {s["pad_x"]}px;
      background:
        linear-gradient(100deg, rgba(4,10,22,0.95) 0%, rgba(4,10,22,0.78) 42%, rgba(4,18,40,0.52) 100%),
        var(--bg);
      background-size: cover;
      background-position: 60% 20%;
    }}
    .copy {{
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: {max(1, min(6, s["pad_y"] * 0.35))}px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }}
    .shop-name {{
      font-size: {s["name"]}px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }}
    .slogan {{ font-family: "Khit", sans-serif; display: flex; flex-direction: column; gap: 0; }}
    .slogan-line {{
      font-size: {s["slogan"]}px;
      line-height: 1.12;
      color: rgba(255,255,255,0.94);
      white-space: nowrap;
    }}
    .handle {{
      font-size: {s["handle"]}px;
      font-weight: 600;
      line-height: 1;
      color: #00d4ff;
      letter-spacing: 0.03em;
    }}
"""

    if spec.design == "split":
        return f"""
    .banner {{
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: {s["gap"]}px;
      padding: {s["pad_y"]}px {s["pad_x"]}px;
      background:
        linear-gradient(90deg, rgba(3,8,18,0.96) 0%, rgba(3,8,18,0.88) 38%, rgba(0,40,70,0.45) 100%),
        var(--bg);
      background-size: cover;
      background-position: 70% 18%;
    }}
    .brand {{ display: flex; align-items: center; gap: {s["gap"] * 0.7}px; min-width: 0; }}
    .shop-name {{
      font-size: {s["name"]}px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }}
    .divider {{
      width: {s["accent_bar"]}px;
      align-self: stretch;
      margin: {s["pad_y"] * 0.4}px 0;
      border-radius: 99px;
      background: linear-gradient(180deg, transparent, #00d4ff, transparent);
    }}
    .slogan {{
      font-family: "Khit", sans-serif;
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0;
      justify-content: center;
    }}
    .slogan-line {{
      font-size: {s["slogan"]}px;
      line-height: 1.1;
      color: rgba(255,255,255,0.94);
      white-space: nowrap;
    }}
    .handle {{ display: none; }}
"""

    if spec.design == "glow":
        return f"""
    .banner {{
      display: flex;
      align-items: center;
      gap: {s["gap"]}px;
      padding: {s["pad_y"]}px {s["pad_x"]}px;
      background:
        radial-gradient(ellipse 55% 140% at 12% 50%, rgba(0,212,255,0.22), transparent 60%),
        linear-gradient(105deg, rgba(4,10,22,0.94) 0%, rgba(4,10,22,0.72) 50%, rgba(8,20,45,0.55) 100%),
        var(--bg);
      background-size: cover;
      background-position: 55% 15%;
    }}
    .banner::before {{
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: {max(4, s["accent_bar"] * 1.4)}px;
      background: linear-gradient(180deg, #00d4ff, #7c5cff, #00d4ff);
      box-shadow: 0 0 18px rgba(0,212,255,0.55);
    }}
    .copy {{
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: {max(1, min(6, s["pad_y"] * 0.3))}px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }}
    .shop-name {{
      font-size: {s["name"]}px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.03em;
      white-space: nowrap;
      text-shadow: 0 0 24px rgba(0,212,255,0.35);
    }}
    .slogan {{ font-family: "Khit", sans-serif; display: flex; flex-direction: column; gap: 0; }}
    .slogan-line {{
      font-size: {s["slogan"]}px;
      line-height: 1.1;
      color: rgba(255,255,255,0.94);
      white-space: nowrap;
    }}
    .handle {{ font-size: {s["handle"]}px; font-weight: 600; line-height: 1; color: #00d4ff; }}
"""

    if spec.design == "center":
        return f"""
    .banner {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: {s["gap"] * 1.2}px;
      padding: {s["pad_y"]}px {s["pad_x"]}px;
      background:
        linear-gradient(180deg, rgba(4,10,22,0.88), rgba(4,10,22,0.82)),
        var(--bg);
      background-size: cover;
      background-position: 50% 18%;
    }}
    .copy {{
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: {max(1, min(5, s["pad_y"] * 0.25))}px;
      overflow: hidden;
    }}
    .shop-name {{
      font-size: {s["name"]}px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }}
    .slogan {{ font-family: "Khit", sans-serif; }}
    .slogan-line {{
      font-size: {s["slogan"]}px;
      line-height: 1.1;
      color: rgba(255,255,255,0.94);
      white-space: nowrap;
    }}
    .handle {{ font-size: {s["handle"]}px; font-weight: 600; line-height: 1; color: #00d4ff; }}
"""

    if spec.design == "strip":
        return f"""
    .banner {{
      display: flex;
      align-items: center;
      gap: {s["gap"] * 0.85}px;
      padding: 0 {s["pad_x"]}px;
      background:
        linear-gradient(90deg, rgba(4,10,22,0.96) 0%, rgba(4,10,22,0.8) 55%, rgba(4,18,40,0.55) 100%),
        var(--bg);
      background-size: cover;
      background-position: 65% 22%;
    }}
    .copy {{
      display: flex;
      align-items: center;
      gap: {s["gap"] * 0.7}px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }}
    .shop-name {{
      font-size: {s["name"]}px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
      flex-shrink: 0;
    }}
    .dot {{
      width: {max(4, s["accent_bar"])}px;
      height: {max(4, s["accent_bar"])}px;
      border-radius: 50%;
      background: #00d4ff;
      flex-shrink: 0;
      box-shadow: 0 0 10px rgba(0,212,255,0.7);
    }}
    .slogan {{ font-family: "Khit", sans-serif; min-width: 0; }}
    .slogan-line {{
      font-size: {s["slogan"]}px;
      line-height: 1;
      color: rgba(255,255,255,0.94);
      white-space: nowrap;
    }}
    .handle {{
      margin-left: auto;
      font-size: {s["handle"]}px;
      font-weight: 600;
      line-height: 1;
      color: #00d4ff;
      white-space: nowrap;
      flex-shrink: 0;
    }}
"""

    # micro — ultra-thin 50px-class banners
    return f"""
    .banner {{
      display: flex;
      align-items: center;
      gap: {s["gap"] * 0.7}px;
      padding: 0 {s["pad_x"]}px;
      background:
        linear-gradient(90deg, rgba(3,8,18,0.97) 0%, rgba(3,8,18,0.85) 50%, rgba(0,45,70,0.55) 100%),
        var(--bg);
      background-size: cover;
      background-position: 70% 20%;
    }}
    .copy {{
      display: flex;
      align-items: center;
      gap: {s["gap"] * 0.55}px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }}
    .shop-name {{
      font-size: {s["name"]}px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }}
    .slogan {{ font-family: "Khit", sans-serif; }}
    .slogan-line {{
      font-size: {s["slogan"]}px;
      line-height: 1;
      color: rgba(255,255,255,0.93);
      white-space: nowrap;
    }}
    .handle {{
      margin-left: auto;
      font-size: {s["handle"]}px;
      font-weight: 600;
      line-height: 1;
      color: #00d4ff;
      white-space: nowrap;
    }}
"""


def _body_html(spec: BannerSpec) -> str:
    logo = '<img class="logo" src="{logo}" alt="{name}" />'
    accent = f'{_esc(SLOGAN_LINE_2_PREFIX)}<span class="accent">{_esc(SLOGAN_LINE_2_ACCENT)}</span>'

    if spec.design == "split":
        return f"""
  <div class="banner">
    <div class="brand">
      {logo}
      <div class="shop-name">{_esc(SHOP_NAME)}</div>
    </div>
    <div class="divider"></div>
    <div class="slogan">
      <div class="slogan-line">{_esc(SLOGAN_LINE_1)}</div>
      <div class="slogan-line">{accent}</div>
    </div>
  </div>
"""

    if spec.design in ("strip", "micro"):
        return f"""
  <div class="banner">
    {logo}
    <div class="copy">
      <div class="shop-name">{_esc(SHOP_NAME)}</div>
      {'<div class="dot"></div>' if spec.design == "strip" else ""}
      <div class="slogan">
        <div class="slogan-line">{_esc(SLOGAN_INLINE)}<span class="accent">{_esc(SLOGAN_LINE_2_ACCENT)}</span></div>
      </div>
      <div class="handle">{_esc(BOT_HANDLE)}</div>
    </div>
  </div>
"""

    # classic / glow / center — stacked copy
    use_two_lines = spec.height >= 180
    show_handle = spec.height >= 160
    if use_two_lines:
        first_line = _esc(SLOGAN_LINE_1)
        second_line = f'<div class="slogan-line">{accent}</div>'
    else:
        first_line = (
            f'{_esc(SLOGAN_INLINE)}<span class="accent">{_esc(SLOGAN_LINE_2_ACCENT)}</span>'
        )
        second_line = ""
    handle = (
        f'<div class="handle">{_esc(BOT_HANDLE)}</div>' if show_handle else ""
    )
    return f"""
  <div class="banner">
    {logo}
    <div class="copy">
      <div class="shop-name">{_esc(SHOP_NAME)}</div>
      <div class="slogan">
        <div class="slogan-line">{first_line}</div>
        {second_line}
      </div>
      {handle}
    </div>
  </div>
"""


def build_html(spec: BannerSpec, font_url: str, logo_url: str, bg_url: str) -> str:
    s = _scale(spec)
    body = _body_html(spec).format(logo=logo_url, name=_esc(SHOP_NAME))
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
    :root {{ --bg: url("{bg_url}") center / cover no-repeat; }}
    body {{
      width: {spec.width}px;
      height: {spec.height}px;
      overflow: hidden;
      font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      color: #fff;
      background: #060e1c;
    }}
    .banner {{
      position: relative;
      width: {spec.width}px;
      height: {spec.height}px;
      overflow: hidden;
    }}
    .banner::after {{
      content: "";
      position: absolute;
      inset: 0;
      border: {s["border"]}px solid rgba(0, 212, 255, 0.28);
      pointer-events: none;
      z-index: 2;
    }}
    .logo {{
      position: relative;
      z-index: 1;
      width: {s["logo"]}px;
      height: {s["logo"]}px;
      border-radius: {s["logo_radius"]}px;
      object-fit: cover;
      flex-shrink: 0;
      box-shadow: 0 6px 18px rgba(0,0,0,0.4);
    }}
    .brand, .copy, .slogan, .shop-name, .handle, .divider, .dot {{
      position: relative;
      z-index: 1;
    }}
    .accent {{
      color: #00d4ff;
      font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      font-weight: 700;
      letter-spacing: 0.04em;
    }}
    {_design_css(spec, s)}
  </style>
</head>
<body>
{body}
</body>
</html>
"""


def render_banner(
    browser,
    spec: BannerSpec,
    font_url: str,
    logo_url: str,
) -> Image.Image:
    bg_path = BACKGROUNDS[spec.bg]
    if not bg_path.exists():
        raise FileNotFoundError(f"Background not found: {bg_path}")
    html_doc = build_html(spec, font_url, logo_url, _data_url(bg_path))
    page = browser.new_page(viewport={"width": spec.width, "height": spec.height})
    try:
        page.set_content(html_doc, wait_until="networkidle")
        page.wait_for_timeout(200)
        png_bytes = page.screenshot(type="png", full_page=False)
    finally:
        page.close()
    return Image.open(io.BytesIO(png_bytes)).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sponsored mobile ad banners.")
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help="Optional banner keys to generate (default: all)",
    )
    parser.add_argument(
        "--outdir",
        type=Path,
        default=OUT_DIR,
        help="Output directory",
    )
    args = parser.parse_args()

    for path in (LOGO_PATH, FONT_PATH):
        if not path.exists():
            raise FileNotFoundError(f"Missing asset: {path}")

    specs = BANNERS
    if args.only:
        wanted = set(args.only)
        specs = [b for b in BANNERS if b.key in wanted]
        missing = wanted - {b.key for b in specs}
        if missing:
            raise SystemExit(f"Unknown banner keys: {', '.join(sorted(missing))}")

    args.outdir.mkdir(parents=True, exist_ok=True)
    font_url = _data_url(FONT_PATH)
    logo_url = _data_url(LOGO_PATH)

    # Also refresh the original single-file path with the best wide classic
    primary = next(b for b in BANNERS if b.key == "wide-200-classic")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for spec in specs:
                img = render_banner(browser, spec, font_url, logo_url)
                out = args.outdir / f"sponsored-{spec.key}-{spec.width}x{spec.height}.png"
                img.save(out, format="PNG", optimize=True)
                print(f"Saved: {out.name}  ({spec.label})")

                if spec.key == primary.key:
                    legacy = ROOT / "assets" / "sponsored-mobile-banner.png"
                    img.save(legacy, format="PNG", optimize=True)
                    print(f"Saved: {legacy.name}  (primary)")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
