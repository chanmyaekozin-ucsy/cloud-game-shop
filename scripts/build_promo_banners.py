#!/usr/bin/env python3
"""
Generate and optimize promo banners for Cloud Game Shop according to mobile banner guidelines:
- 1080 × 540 px (2:1 aspect ratio, @3x Retina)
- 1200 × 630 px (1.91:1 standard landscape)
- 720 × 360 px (2:1 lightweight @2x)
- Safe zone: 40px outer padding, 22px border radius ready
- Outputs WebP (50KB-120KB) and high quality JPG / PNG
"""

import base64
import os
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
OUT_DIR = ASSETS_DIR / "promo-banners"
WEB_PUBLIC_DIR = ROOT / "web" / "public" / "banners"

OUT_DIR.mkdir(parents=True, exist_ok=True)
WEB_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

BRAIN_DIR = Path("/Users/chanmyaekozin/.gemini/antigravity-ide/brain/01559aec-4813-4bf9-865f-d3b1432cdf5a")

GENERATED_IMAGES = [
    ("banner-cyber-esports", BRAIN_DIR / "cloud_game_shop_promo_banner_1787239067221.jpg"),
    ("banner-flash-sale", BRAIN_DIR / "cloud_game_shop_flash_sale_banner_1787239086057.jpg"),
    ("banner-clean-hero", BRAIN_DIR / "cloud_game_shop_clean_hero_1787239114093.jpg"),
]

SIZES = [
    ("1080x540", 1080, 540, "2:1 Recommended @3x"),
    ("1200x630", 1200, 630, "1.91:1 Landscape Standard"),
    ("720x360", 720, 360, "2:1 Lightweight @2x"),
]

def crop_and_resize(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Crop center to target aspect ratio and resize with high quality Lanczos filter."""
    img_w, img_h = img.size
    target_ratio = target_w / target_h
    src_ratio = img_w / img_h

    if src_ratio > target_ratio:
        # Source is wider than target -> crop left & right
        new_w = int(img_h * target_ratio)
        left = (img_w - new_w) // 2
        img_cropped = img.crop((left, 0, left + new_w, img_h))
    else:
        # Source is taller than target -> crop top & bottom
        new_h = int(img_w / target_ratio)
        top = (img_h - new_h) // 2
        img_cropped = img.crop((0, top, img_w, top + new_h))

    return img_cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

def process_ai_banners():
    print("🎨 Processing AI generated banners into required mobile resolutions & WebP...")
    for name, img_path in GENERATED_IMAGES:
        if not img_path.exists():
            print(f"Skipping {name}, path not found: {img_path}")
            continue

        with Image.open(img_path) as im:
            rgb_im = im.convert("RGB")
            for size_label, w, h, desc in SIZES:
                resized = crop_and_resize(rgb_im, w, h)
                
                # 1. Save WebP (Quality 85, ideal 50-120KB)
                webp_path_assets = OUT_DIR / f"{name}-{size_label}.webp"
                webp_path_web = WEB_PUBLIC_DIR / f"{name}-{size_label}.webp"
                resized.save(webp_path_assets, "WEBP", quality=85, method=6)
                resized.save(webp_path_web, "WEBP", quality=85, method=6)
                webp_size_kb = webp_path_assets.stat().st_size / 1024

                # 2. Save JPG (Quality 88)
                jpg_path_assets = OUT_DIR / f"{name}-{size_label}.jpg"
                jpg_path_web = WEB_PUBLIC_DIR / f"{name}-{size_label}.jpg"
                resized.save(jpg_path_assets, "JPEG", quality=88, optimize=True)
                resized.save(jpg_path_web, "JPEG", quality=88, optimize=True)
                jpg_size_kb = jpg_path_assets.stat().st_size / 1024

                # 3. Save PNG (for highest fidelity @3x only)
                if size_label == "1080x540":
                    png_path_assets = OUT_DIR / f"{name}-{size_label}.png"
                    png_path_web = WEB_PUBLIC_DIR / f"{name}-{size_label}.png"
                    resized.save(png_path_assets, "PNG", optimize=True)
                    resized.save(png_path_web, "PNG", optimize=True)

                print(f"  ✓ {name} ({size_label}) -> WebP: {webp_size_kb:.1f} KB | JPG: {jpg_size_kb:.1f} KB")

def generate_html_hybrid_banners():
    """Render pixel-perfect HTML/CSS banners with custom fonts, official logo, and Myanmar slogan."""
    print("\n⚡ Rendering official HTML+CSS Cloud Game Shop banners via Playwright...")
    
    clean_bg_path = BRAIN_DIR / "cloud_game_shop_clean_hero_1787239114093.jpg"
    logo_path = ASSETS_DIR / "cloud-gameshop-logo.png"
    font_khit = ASSETS_DIR / "A09_Khit-Normal.ttf"

    clean_bg_b64 = ""
    if clean_bg_path.exists():
        with open(clean_bg_path, "rb") as f:
            clean_bg_b64 = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"

    logo_b64 = ""
    if logo_path.exists():
        with open(logo_path, "rb") as f:
            logo_b64 = f"data:image/png;base64,{base64.b64encode(f.read()).decode('utf-8')}"

    font_b64 = ""
    if font_khit.exists():
        with open(font_khit, "rb") as f:
            font_b64 = f"data:font/ttf;base64,{base64.b64encode(f.read()).decode('utf-8')}"

    html_template = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {{
  font-family: 'Khit';
  src: url('{font_b64}') format('truetype');
}}
* {{
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}}
body {{
  width: 1080px;
  height: 540px;
  background: #070a14;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  color: #fff;
}}
.banner-container {{
  position: relative;
  width: 1080px;
  height: 540px;
  background-image: url('{clean_bg_b64}');
  background-size: cover;
  background-position: center;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 44px 50px 40px 50px;
}}
.overlay {{
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(7, 10, 20, 0.94) 0%, rgba(7, 10, 20, 0.82) 42%, rgba(7, 10, 20, 0.25) 75%, rgba(7, 10, 20, 0.1) 100%),
              linear-gradient(180deg, rgba(7, 10, 20, 0.2) 0%, transparent 40%, rgba(7, 10, 20, 0.75) 100%);
  pointer-events: none;
}}
.content {{
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  height: 100%;
  justify-content: space-between;
}}
.top-section {{
  display: flex;
  align-items: center;
  gap: 16px;
}}
.logo-badge {{
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: rgba(14, 23, 42, 0.8);
  border: 1.5px solid rgba(56, 189, 248, 0.4);
  box-shadow: 0 0 25px rgba(56, 189, 248, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}}
.logo-badge img {{
  width: 100%;
  height: 100%;
  object-fit: cover;
}}
.brand-titles {{
  display: flex;
  flex-direction: column;
}}
.brand-name {{
  font-size: 38px;
  font-weight: 900;
  letter-spacing: -0.5px;
  text-transform: uppercase;
  background: linear-gradient(135deg, #ffffff 30%, #38bdf8 70%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 30px rgba(56, 189, 248, 0.5);
}}
.brand-sub {{
  font-family: 'Khit', sans-serif;
  font-size: 22px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 6px;
}}
.brand-sub span.highlight {{
  color: #38bdf8;
  font-weight: bold;
}}
.middle-section {{
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 580px;
}}
.headline {{
  font-size: 42px;
  font-weight: 900;
  line-height: 1.15;
  color: #f8fafc;
  text-shadow: 0 4px 20px rgba(0,0,0,0.8);
}}
.headline span.glow {{
  color: #38bdf8;
  text-shadow: 0 0 20px rgba(56, 189, 248, 0.8);
}}
.tags-row {{
  display: flex;
  gap: 10px;
  align-items: center;
}}
.game-pill {{
  padding: 8px 16px;
  border-radius: 30px;
  background: rgba(30, 41, 59, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.25);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #e2e8f0;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}}
.game-pill.mlbb {{
  border-color: rgba(245, 158, 11, 0.5);
  color: #fbbf24;
  background: rgba(120, 53, 15, 0.3);
}}
.game-pill.pubg {{
  border-color: rgba(239, 68, 68, 0.5);
  color: #f87171;
  background: rgba(127, 29, 29, 0.3);
}}
.game-pill.ff {{
  border-color: rgba(168, 85, 247, 0.5);
  color: #c084fc;
  background: rgba(88, 28, 135, 0.3);
}}
.bottom-section {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
}}
.instant-callout {{
  display: flex;
  align-items: center;
  gap: 10px;
  background: linear-gradient(90deg, rgba(6, 182, 212, 0.25), rgba(59, 130, 246, 0.15));
  border: 1px solid rgba(6, 182, 212, 0.5);
  padding: 10px 20px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 18px;
  color: #22d3ee;
  box-shadow: 0 0 20px rgba(6, 182, 212, 0.3);
}}
.instant-callout .icon {{
  font-size: 22px;
}}
.speed-badge {{
  font-family: 'Khit', sans-serif;
  font-size: 18px;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.8);
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}}
</style>
</head>
<body>
<div class="banner-container">
  <div class="overlay"></div>
  <div class="content">
    <div class="top-section">
      <div class="logo-badge">
        <img src="{logo_b64}" alt="Cloud Game Shop Logo">
      </div>
      <div class="brand-titles">
        <div class="brand-name">Cloud Game Shop</div>
        <div class="brand-sub">အခုလွှဲ အခုရောက် <span class="highlight">စိတ်ချရတဲ့ CLOUD</span></div>
      </div>
    </div>
    
    <div class="middle-section">
      <div class="headline">
        အမြန်ဆုံး & အချိုသာဆုံး <span class="glow">Game Top-Up</span>
      </div>
      <div class="tags-row">
        <div class="game-pill mlbb">⚡ MLBB Diamonds</div>
        <div class="game-pill pubg">🎯 PUBG UC</div>
        <div class="game-pill ff">🔥 Free Fire</div>
      </div>
    </div>
    
    <div class="bottom-section">
      <div class="instant-callout">
        <span class="icon">⚡</span> 100% INSTANT AUTO DELIVERY
      </div>
      <div class="speed-badge">
        24/7 စိတ်ချရသော ဝန်ဆောင်မှု
      </div>
    </div>
  </div>
</div>
</body>
</html>
"""

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1080, "height": 540, "device_scale_factor": 1})
        page.set_content(html_template)
        page.wait_for_timeout(500)
        
        # Save high-res screenshot
        master_png = OUT_DIR / "banner-official-branded-1080x540.png"
        page.screenshot(path=str(master_png), type="png")
        browser.close()

    # Generate all variations from master
    with Image.open(master_png) as im:
        rgb_im = im.convert("RGB")
        name = "banner-official-branded"
        for size_label, w, h, desc in SIZES:
            resized = crop_and_resize(rgb_im, w, h)
            
            # WebP
            webp_assets = OUT_DIR / f"{name}-{size_label}.webp"
            webp_web = WEB_PUBLIC_DIR / f"{name}-{size_label}.webp"
            resized.save(webp_assets, "WEBP", quality=85, method=6)
            resized.save(webp_web, "WEBP", quality=85, method=6)
            
            # JPG
            jpg_assets = OUT_DIR / f"{name}-{size_label}.jpg"
            jpg_web = WEB_PUBLIC_DIR / f"{name}-{size_label}.jpg"
            resized.save(jpg_assets, "JPEG", quality=88, optimize=True)
            resized.save(jpg_web, "JPEG", quality=88, optimize=True)
            
            if size_label == "1080x540":
                png_web = WEB_PUBLIC_DIR / f"{name}-{size_label}.png"
                resized.save(png_web, "PNG", optimize=True)
                
            print(f"  ✓ {name} ({size_label}) -> WebP: {webp_assets.stat().st_size / 1024:.1f} KB | JPG: {jpg_assets.stat().st_size / 1024:.1f} KB")

if __name__ == "__main__":
    process_ai_banners()
    generate_html_hybrid_banners()
    print("\n✅ All promo banners generated, resized, and optimized successfully!")
