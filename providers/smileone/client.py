"""HTTP client for Smile.one with automatic session refresh."""

from __future__ import annotations

import os
import sys
import urllib.error

from providers.smileone.auth import SmileAuthError, login_with_google, refresh_session
from providers.smileone.config import load_env, order_url, timeout
from providers.smileone.http import (
    extract_csrf,
    fetch_html,
    fetch_json,
    looks_like_login_page,
    parse_balance,
    post_form,
    post_json,
)
from providers.smileone.mlbb import (
    MlbbAccount,
    MlbbPackage,
    MLBB_PAY_METHOD,
    fetch_mlbb_validasi,
    mlbb_checkrole_url,
    mlbb_customer_url,
    mlbb_merchant_referer,
    mlbb_merchant_url,
    mlbb_pay_error_message,
    mlbb_pay_succeeded,
    mlbb_pay_url,
    mlbb_query_url,
    parse_mlbb_account,
    parse_mlbb_packages,
)
from providers.smileone.orders import (
    DEFAULT_ORDERLIST_PAGE_SIZE,
    OrderHistoryPage,
    build_orderlist_url,
    parse_order_history,
)
from providers.smileone.session import SmileSession


class SmileOneClient:
    """
    Smile.one API wrapper.

    Loads cookies from `.data/smileone_session.json`. On expiry, automatically
    re-runs browser Google login (if the browser profile is still signed in to Google).
    """

    def __init__(self, *, auto_relogin: bool = True) -> None:
        self.auto_relogin = auto_relogin
        self._session: SmileSession | None = None
        self._relogin_attempted = False

    @property
    def session(self) -> SmileSession:
        if self._session is None:
            loaded = SmileSession.load()
            if loaded is None:
                raise SmileAuthError(
                    "No session file. Run: python scripts/smileone_login.py"
                )
            self._session = loaded
        return self._session

    @property
    def cookie(self) -> str:
        return self.session.cookie_header

    def ensure_logged_in(self, *, force_browser: bool = False) -> SmileSession:
        if force_browser:
            self._session = refresh_session()
            self._relogin_attempted = False
            return self._session

        loaded = SmileSession.load()
        if loaded and loaded.has_phpsessid():
            self._session = loaded
            return loaded

        self._session = login_with_google()
        return self._session

    def _maybe_relogin(self) -> bool:
        if not self.auto_relogin or self._relogin_attempted:
            return False
        self._relogin_attempted = True
        try:
            self._session = login_with_google(force=True)
            return True
        except SmileAuthError:
            return False

    def get_html(
        self,
        url: str,
        *,
        referer: str | None = None,
        retry_on_expiry: bool = True,
    ) -> tuple[str, str]:
        self.ensure_logged_in()
        try:
            html, final_url = fetch_html(url, self.cookie, timeout(), referer=referer)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and retry_on_expiry and self._maybe_relogin():
                return self.get_html(url, referer=referer, retry_on_expiry=False)
            raise

        if retry_on_expiry and looks_like_login_page(html, final_url=final_url):
            if self._maybe_relogin():
                return self.get_html(url, referer=referer, retry_on_expiry=False)
            raise SmileAuthError("Session expired and auto re-login failed.")

        return html, final_url

    def get_json(self, url: str, *, referer: str, retry_on_expiry: bool = True):
        self.ensure_logged_in()
        data, err = fetch_json(url, self.cookie, timeout(), referer=referer)
        if err == "session_expired" and retry_on_expiry and self._maybe_relogin():
            return self.get_json(url, referer=referer, retry_on_expiry=False)
        if err:
            raise SmileAuthError(err)
        return data

    def get_balance(self) -> str:
        html, _ = self.get_html(order_url())
        balance = parse_balance(html)
        if balance is None:
            raise SmileAuthError("Could not parse balance from Smile.one page.")
        return balance

    def get_order_history(
        self,
        start_date: str,
        end_date: str,
        *,
        page: int = 1,
        page_size: int | None = None,
    ) -> OrderHistoryPage:
        if page_size is None:
            page_size = int(
                os.environ.get("SMILE_ORDERLIST_PAGE_SIZE", str(DEFAULT_ORDERLIST_PAGE_SIZE))
            )
        ou = order_url()
        url = build_orderlist_url(
            ou,
            startdate=start_date,
            enddate=end_date,
            page=page,
            page_size=page_size,
        )
        data = self.get_json(url, referer=ou.rstrip("/"))
        if not isinstance(data, dict):
            raise SmileAuthError("Unexpected order history response.")
        return parse_order_history(data, page=page, page_size=page_size)

    def check_mlbb_account(self, game_id: str, server_id: str) -> MlbbAccount | str:
        data, err = fetch_mlbb_validasi(game_id, server_id, timeout())
        if err:
            return err
        assert data is not None
        return parse_mlbb_account(game_id, server_id, data)

    def get_mlbb_packages(self) -> list[MlbbPackage]:
        page_url = mlbb_merchant_url()
        referer = mlbb_merchant_referer()
        html, _ = self.get_html(page_url, referer=referer)
        if looks_like_login_page(html) and "info = JSON.parse" not in html:
            raise SmileAuthError("Not logged in or merchant page blocked.")
        packages = parse_mlbb_packages(html)
        if not packages:
            raise SmileAuthError("Could not find MLBB packages in merchant HTML.")
        return packages

    def pay_mlbb(
        self,
        *,
        game_id: str,
        server_id: str,
        goods_id: str,
    ) -> str:
        """Pay for an MLBB package with Smile Coin. Returns admin note on success."""
        page_url = mlbb_merchant_url()
        referer = mlbb_merchant_referer()
        html, _ = self.get_html(page_url, referer=referer)
        csrf = extract_csrf(html)
        if not csrf:
            raise SmileAuthError("Could not parse CSRF from Smile.one merchant page.")

        base_payload = {
            "user_id": game_id.strip(),
            "zone_id": server_id.strip(),
            "pid": goods_id.strip(),
            "pay_methond": MLBB_PAY_METHOD,
            "channel_method": MLBB_PAY_METHOD,
        }

        check_data, err = post_json(
            mlbb_checkrole_url(),
            self.cookie,
            {**base_payload, "checkrole": "1"},
            timeout(),
            referer=referer,
        )
        if err == "session_expired" and self._maybe_relogin():
            return self.pay_mlbb(game_id=game_id, server_id=server_id, goods_id=goods_id)
        if err:
            raise SmileAuthError(err)
        assert check_data is not None
        if int(check_data.get("code", 0)) != 200:
            raise SmileAuthError(str(check_data.get("info") or "MLBB account check failed."))

        query_data, err = post_json(
            mlbb_query_url(),
            self.cookie,
            {**base_payload, "checkrole": ""},
            timeout(),
            referer=referer,
        )
        if err:
            raise SmileAuthError(err)
        assert query_data is not None
        if int(query_data.get("code", 0)) != 200:
            raise SmileAuthError(str(query_data.get("info") or "MLBB order query failed."))
        flowid = str(query_data.get("flowid") or "").strip()
        if not flowid:
            raise SmileAuthError("Smile.one did not return a payment flow id.")

        customer_data, err = post_json(
            mlbb_customer_url(),
            self.cookie,
            {"check": "check"},
            timeout(),
            referer=referer,
        )
        if err:
            raise SmileAuthError(err)
        assert customer_data is not None
        if int(customer_data.get("code", 0)) != 200:
            raise SmileAuthError("Smile.one customer check failed.")

        pay_html, final_url = post_form(
            mlbb_pay_url(),
            self.cookie,
            {
                "user_id": game_id.strip(),
                "zone_id": server_id.strip(),
                "pay_methond": MLBB_PAY_METHOD,
                "product_id": goods_id.strip(),
                "channel_method": MLBB_PAY_METHOD,
                "flowid": flowid,
                "email": "",
                "coupon_id": "",
                "_csrf": csrf,
            },
            timeout(),
            referer=page_url,
        )
        if mlbb_pay_succeeded(final_url=final_url, html=pay_html):
            return f"Smile.one top-up OK (goods {goods_id})"
        pay_err = mlbb_pay_error_message(pay_html)
        raise SmileAuthError(pay_err or "Smile.one payment failed.")


def main() -> int:
    load_env()
    client = SmileOneClient()
    try:
        balance = client.get_balance()
    except SmileAuthError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(f"Balance: {balance}")
    print(f"Session: {client.session.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
