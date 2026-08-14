"""Smile.one configuration and environment loading."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / ".data"
BROWSER_PROFILE_DIR = DATA_DIR / "browser_profile"
PROFILE_SETUP_FLAG = DATA_DIR / "browser_profile_ready"

DEFAULT_REGION = "br"
DEFAULT_TIMEOUT = 30
DEFAULT_ORDER_URL = "https://www.smile.one/br/customer/order"
DEFAULT_LOGIN_WAIT_SECONDS = 120

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def load_env(path: Path | None = None, *, override: bool = False) -> None:
    """Load KEY=value pairs from a .env file into os.environ."""
    env_path = path or (PROJECT_ROOT / ".env")
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, _, val = line.partition("=")
        key = key.strip()
        if not key:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if override or key not in os.environ:
            os.environ[key] = val


def session_path() -> Path:
    """
    Smile.one cookie session file.

    Coolify (shared with web Admin → Supplier):
      SMILE_SESSION_PATH=/data/smileone/smileone_session.json
    Local default:
      .data/smileone_session.json
    """
    raw = (os.environ.get("SMILE_SESSION_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return DATA_DIR / "smileone_session.json"


# Back-compat alias — prefer session_path() so env is read after load_env().
SESSION_PATH = DATA_DIR / "smileone_session.json"


def region() -> str:
    return os.environ.get("SMILE_REGION", DEFAULT_REGION).strip().lower() or DEFAULT_REGION


def timeout() -> int:
    return int(os.environ.get("SMILE_TIMEOUT", str(DEFAULT_TIMEOUT)))


def headless() -> bool:
    """Headless refresh often fails Google OAuth; profile cookie sync works headless."""
    return os.environ.get("SMILE_HEADLESS", "true").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def refresh_headless() -> bool:
    """Headless profile sync; OAuth auto-clicks in same browser session."""
    return os.environ.get("SMILE_REFRESH_HEADLESS", "false").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def login_wait_seconds() -> int:
    return int(os.environ.get("SMILE_LOGIN_WAIT_SECONDS", str(DEFAULT_LOGIN_WAIT_SECONDS)))


def browser_channel() -> str | None:
    """Use installed Chrome when available (better for Google OAuth)."""
    raw = os.environ.get("SMILE_BROWSER_CHANNEL", "chrome").strip()
    return raw or None


def profile_is_ready() -> bool:
    return PROFILE_SETUP_FLAG.is_file() and BROWSER_PROFILE_DIR.is_dir()


def mark_profile_ready() -> None:
    ensure_data_dir()
    PROFILE_SETUP_FLAG.write_text("ok\n", encoding="utf-8")


def order_url() -> str:
    return os.environ.get("SMILE_ORDER_URL", DEFAULT_ORDER_URL)


def login_url() -> str:
    return f"https://www.smile.one/{region()}/customer/account/login"


def ensure_data_dir() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR


def ensure_session_parent() -> Path:
    path = session_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.parent
