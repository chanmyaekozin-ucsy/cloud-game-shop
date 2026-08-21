#!/usr/bin/env python3
"""
Generate clean, natural Cloud Game Shop MLBB mobile promo banners:
- Exclusively Mobile Legends: Bang Bang (MLBB only - no PUBG, no Free Fire)
- Consistent single font throughout (no mixed fonts, no system font overrides)
- Absolutely NO emojis
- Based on cgs-bg1.jpeg and cgs-bg3.jpg (with support for cgs-bg2.jpeg)
- Natural overlay, no heavy gradients, no harsh borders
- Standard mobile promo sizes:
    * 1080 × 540 px (2:1 @3x Recommended)
    * 1200 × 630 px (1.91:1 Universal Landscape)
    * 720 × 360 px (2:1 Lightweight @2x)
- Output formats: WebP (50-120 KB), PNG, and JPG.
"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
OUT_DIR = ASSETS_DIR / "promo-banners"
WEB_PUBLIC_DIR = ROOT / "web" / "public" / "banners"

OUT_DIR.mkdir(parents=True, exist_ok=True)
WEB_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

LOGO_PATH = ASSETS_DIR / "cloud-gameshop-logo.png"
FONT_THUNGALTAN = ASSETS_DIR / "A16_ThuNgalTan-Regular.ttf"
FONT_KHIT = ASSETS_DIR / "A09_Khit-Normal.ttf"

BACKGROUNDS = {
    "cgs-bg1": {
        "path": ASSETS_DIR / "cgs-bg1.jpeg",
        "title": "Luo Yi Sunset (MLBB)",
        "overlay": "linear-gradient(90deg, rgba(8, 7, 12, 0.86) 0%, rgba(8, 7, 12, 0.68) 46%, rgba(8, 7, 12, 0.18) 72%, rgba(8, 7, 12, 0.0) 100%)",
        "accent": "#38bdf8",
    },
    "cgs-bg3": {
        "path": ASSETS_DIR / "cgs-bg3.jpg",
        "title": "Kagura Spring (MLBB)",
        "overlay": "linear-gradient(90deg, rgba(8, 14, 24, 0.86) 0%, rgba(8, 14, 24, 0.65) 48%, rgba(8, 14, 24, 0.16) 74%, rgba(8, 14, 24, 0.0) 100%)",
        "accent": "#38bdf8",
    },
    "cgs-bg2": {
        "path": ASSETS_DIR / "cgs-bg2.jpeg",
        "title": "Angela Magical (MLBB)",
        "overlay": "linear-gradient(90deg, rgba(14, 8, 20, 0.86) 0%, rgba(14, 8, 20, 0.68) 46%, rgba(14, 8, 20, 0.18) 72%, rgba(14, 8, 20, 0.0) 100%)",
        "accent": "#38bdf8",
    },
}

SIZES = [
    ("1080x540", 1080, 540, "2:1 Recommended @3x"),
    ("1200x630", 1200, 630, "1.91:1 Universal Landscape"),
    ("720x360", 720, 360, "2:1 Lightweight @2x"),
]


def to_data_url(path: Path, mime: str) -> str:
    if not path.exists():
        return ""
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def render_html_banner(bg_key: str, config: dict, font_choice: str = "thungaltan") -> str:
    font_file = FONT_THUNGALTAN if font_choice == "thungaltan" else FONT_KHIT
    font_b64 = to_data_url(font_file, "font/ttf")
    logo_b64 = to_data_url(LOGO_PATH, "image/png")
    bg_b64 = to_data_url(config["path"], "image/jpeg")

    return f"""<!DOCTYPE html>
<html lang="my">
<head>
<meta charset="utf-8">
<style>
@font-face {{
  font-family: 'SingleBrandFont';
  src: url('{font_b64}') format('truetype');
  font-weight: normal;
  font-style: normal;
}}

* {{
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: 'SingleBrandFont', sans-serif !important;
}}

body {{
  width: 1080px;
  height: 540px;
  background: #090d16;
  overflow: hidden;
  color: #ffffff;
  -webkit-font-smoothing: antialiased;
}}

.banner {{
  position: relative;
  width: 1080px;
  height: 540px;
  background-image: url('{bg_b64}');
  background-size: cover;
  background-position: center right;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 44px 50px;
}}

/* Soft, natural background blend */
.scrim {{
  position: absolute;
  inset: 0;
  background: {config['overlay']};
  pointer-events: none;
}}

.bottom-shadow {{
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 90px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0%, transparent 100%);
  pointer-events: none;
}}

.content {{
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  max-width: 590px;
}}

/* 1. Header: Logo, Shop Name & Slogan */
.brand-header {{
  display: flex;
  align-items: center;
  gap: 16px;
}}

.logo-box {{
  width: 60px;
  height: 60px;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}}

.logo-box img {{
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}}

.brand-text {{
  display: flex;
  flex-direction: column;
  gap: 2px;
}}

.brand-name {{
  font-size: 27px;
  font-weight: bold;
  letter-spacing: -0.2px;
  color: #ffffff;
  line-height: 1.15;
}}

.brand-slogan {{
  font-size: 19px;
  color: rgba(255, 255, 255, 0.88);
  line-height: 1.25;
}}

.brand-slogan .accent {{
  color: #38bdf8;
  font-weight: bold;
}}

/* 2. Middle MLBB Content */
.middle-promo {{
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 10px 0;
}}

.promo-headline {{
  font-size: 32px;
  line-height: 1.25;
  color: #ffffff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}}

.promo-headline .highlight {{
  color: #38bdf8;
}}

.packages-row {{
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}}

.pkg-chip {{
  display: inline-flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.6);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.92);
}}

/* 3. Bottom Service Info */
.bottom-row {{
  display: flex;
  align-items: center;
  gap: 16px;
}}

.delivery-badge {{
  display: inline-flex;
  align-items: center;
  background: rgba(56, 189, 248, 0.12);
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 15.5px;
  color: #bae6fd;
}}

.telegram-handle {{
  font-size: 14px;
  color: rgba(255, 255, 255, 0.65);
}}
</style>
</head>
<body>
<div class="banner">
  <div class="scrim"></div>
  <div class="bottom-shadow"></div>
  
  <div class="content">
    <!-- Brand Header -->
    <div class="brand-header">
      <div class="logo-box">
        <img src="{logo_b64}" alt="Cloud Game Shop Logo">
      </div>
      <div class="brand-text">
        <div class="brand-name">Cloud Game Shop</div>
        <div class="brand-slogan">
          အခုလွှဲ အခုရောက် စိတ်ချရတဲ့ <span class="accent">CLOUD</span>
        </div>
      </div>
    </div>

    <!-- MLBB Exclusive Promotional Content -->
    <div class="middle-promo">
      <div class="promo-headline">
        စောင့်စရာမလိုပဲ <span class="highlight">စက္ကန့်ပိုင်းအတွင်း</span> အမြန်ဖြည့်နိုင်ပါတယ်။ 
      </div>
      <div class="packages-row">
        <div class="pkg-chip">Direct Diamonds Top-Up</div>
        <div class="pkg-chip">Weekly Diamond Pass</div>
        <div class="pkg-chip">Twilight Pass</div>
      </div>
    </div>

    <!-- Bottom Service Info (No Emojis) -->
    <div class="bottom-row">
      <div class="delivery-badge">
        အလိုအလျောက် ငွေဖြည့်စနစ် Direct Top-Up
      </div>
      <div class="telegram-handle">
        @cloud_gameshop_bot
      </div>
    </div>
  </div>
</div>
</body>
</html>
"""


def crop_center_resize(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Center crop to exact target aspect ratio and resize smoothly."""
    img_w, img_h = img.size
    target_ratio = target_w / target_h
    src_ratio = img_w / img_h

    if src_ratio > target_ratio:
        new_w = int(img_h * target_ratio)
        left = (img_w - new_w) // 2
        cropped = img.crop((left, 0, left + new_w, img_h))
    else:
        new_h = int(img_w / target_ratio)
        top = (img_h - new_h) // 2
        cropped = img.crop((0, top, img_w, top + new_h))

    return cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)


def generate_banners(target_bg: str = "all", font_choice: str = "thungaltan"):
    bgs_to_process = BACKGROUNDS if target_bg == "all" else {target_bg: BACKGROUNDS[target_bg]}
    print(f"🚀 Generating MLBB-only promo banners (Font: {font_choice}, No emojis, Clean)...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch()
        
        for bg_key, config in bgs_to_process.items():
            if not config["path"].exists():
                print(f"⚠️  Background not found: {config['path']}")
                continue

            print(f"\n✨ Rendering {bg_key} ({config['title']})...")
            html_content = render_html_banner(bg_key, config, font_choice=font_choice)

            page = browser.new_page(viewport={"width": 1080, "height": 540, "device_scale_factor": 1})
            page.set_content(html_content)
            page.wait_for_timeout(300)

            # Master PNG (1080x540)
            master_png_path = OUT_DIR / f"{bg_key}-mlbb-1080x540.png"
            page.screenshot(path=str(master_png_path), type="png")
            page.close()

            # Process into all required sizes and formats
            with Image.open(master_png_path) as master_img:
                rgb_img = master_img.convert("RGB")
                
                for size_label, w, h, desc in SIZES:
                    resized = crop_center_resize(rgb_img, w, h)
                    
                    # 1. WebP (Optimal 50-120 KB)
                    webp_assets = OUT_DIR / f"{bg_key}-mlbb-{size_label}.webp"
                    webp_web = WEB_PUBLIC_DIR / f"{bg_key}-mlbb-{size_label}.webp"
                    resized.save(webp_assets, "WEBP", quality=86, method=6)
                    resized.save(webp_web, "WEBP", quality=86, method=6)
                    webp_kb = webp_assets.stat().st_size / 1024

                    # 2. JPG (High quality)
                    jpg_assets = OUT_DIR / f"{bg_key}-mlbb-{size_label}.jpg"
                    jpg_web = WEB_PUBLIC_DIR / f"{bg_key}-mlbb-{size_label}.jpg"
                    resized.save(jpg_assets, "JPEG", quality=88, optimize=True)
                    resized.save(jpg_web, "JPEG", quality=88, optimize=True)
                    jpg_kb = jpg_assets.stat().st_size / 1024

                    # 3. Web PNG (1080x540 only)
                    if size_label == "1080x540":
                        png_web = WEB_PUBLIC_DIR / f"{bg_key}-mlbb-{size_label}.png"
                        resized.save(png_web, "PNG", optimize=True)

                    print(f"  → [{size_label}] WebP: {webp_kb:.1f} KB | JPG: {jpg_kb:.1f} KB")

        browser.close()

    print("\n✅ All MLBB promo banners generated successfully!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate MLBB Cloud Game Shop promo banners.")
    parser.add_argument("--bg", choices=["all", "cgs-bg1", "cgs-bg2", "cgs-bg3"], default="all", help="Target background")
    parser.add_argument("--font", choices=["thungaltan", "khit"], default="thungaltan", help="Consistent single font choice (default: thungaltan)")
    args = parser.parse_args()
    generate_banners(target_bg=args.bg, font_choice=args.font)
