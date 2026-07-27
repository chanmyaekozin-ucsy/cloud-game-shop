"""WavePay official HTTP client — login, balance, P2P send-money, history."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

from payments.wave.wave_crypto import encrypt_pin_token

BASE_URL = "https://api.wavemoney.io:8100"

OFFICIAL_APP_ID = "mm.com.wavemoney.wavepay"
OFFICIAL_APP_VERSION = "2.6.1"
OFFICIAL_VERSION_CODE = "1470"
OKHTTP_UA = "okhttp/4.9.0"
DART_UA = "Dart/3.2 (dart:io)"


def _norm_msisdn(raw: str) -> str:
    s = raw.strip().replace(" ", "")
    if s.startswith("+95"):
        s = s[3:]
    elif s.startswith("95") and len(s) > 10:
        s = s[2:]
    if s.startswith("09"):
        s = s[1:]
    return s


@dataclass
class DeviceProfile:
    """Device headers matching official OkHttp interceptor (WavePay 2.6.1)."""

    deviceid: str
    fingerprint: str
    device: str = "Wathan Lover (24115RA8ED)"
    manufacturer: str = "Xiaomi"
    model: str = "24115RA8ED"
    product: str = "sunny_global"
    osversion: str = "12"
    cpuabi: str = "arm64-v8a,armeabi-v7a,armeabi"
    appid: str = OFFICIAL_APP_ID
    appversion: str = OFFICIAL_APP_VERSION
    versioncode: str = OFFICIAL_VERSION_CODE
    userlanguage: str = "my"

    def headers(
        self,
        *,
        wmt_mfs: str | None = None,
        accept_json: bool = False,
        client: str = "okhttp",
    ) -> dict[str, str]:
        h = {
            "fingerprint": self.fingerprint,
            "device": self.device,
            "cpuAbi": self.cpuabi,
            "manufacturer": self.manufacturer,
            "model": self.model,
            "product": self.product,
            "osVersion": self.osversion,
            "appId": self.appid or OFFICIAL_APP_ID,
            "appVersion": self.appversion or OFFICIAL_APP_VERSION,
            "versionCode": self.versioncode or OFFICIAL_VERSION_CODE,
            "deviceId": self.deviceid,
            "userLanguage": self.userlanguage,
            "accept-encoding": "application/json" if accept_json else "gzip",
        }
        if client == "dart":
            h["user-agent"] = DART_UA
        elif client == "history":
            h["user-agent"] = OKHTTP_UA
            h["x-requested-with"] = OFFICIAL_APP_ID
            h["accept"] = "*/*"
        else:
            h["user-agent"] = OKHTTP_UA
        if wmt_mfs:
            h["wmt-mfs"] = wmt_mfs
        return h


@dataclass
class WaveSession:
    msisdn: str = ""
    wmt_mfs: str = ""
    device: DeviceProfile = field(
        default_factory=lambda: DeviceProfile(deviceid="", fingerprint="")
    )
    agent_id: int | None = None
    name: str = ""
    balance: float | None = None
    notification_token: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WaveSession":
        d = data.get("device") or {}
        device = DeviceProfile(
            deviceid=str(d.get("deviceid") or data.get("deviceid") or ""),
            fingerprint=str(d.get("fingerprint") or data.get("fingerprint") or ""),
            device=str(d.get("device") or "Wathan Lover (24115RA8ED)"),
            manufacturer=str(d.get("manufacturer") or "Xiaomi"),
            model=str(d.get("model") or "24115RA8ED"),
            product=str(d.get("product") or "sunny_global"),
            osversion=str(d.get("osversion") or "12"),
            cpuabi=str(d.get("cpuabi") or "arm64-v8a,armeabi-v7a,armeabi"),
            appid=OFFICIAL_APP_ID,
            appversion=str(d.get("appversion") or OFFICIAL_APP_VERSION),
            versioncode=str(d.get("versioncode") or OFFICIAL_VERSION_CODE),
            userlanguage=str(d.get("userlanguage") or "my"),
        )
        return cls(
            msisdn=str(data.get("msisdn") or ""),
            wmt_mfs=str(data.get("wmt_mfs") or ""),
            device=device,
            agent_id=data.get("agent_id"),
            name=str(data.get("name") or ""),
            balance=data.get("balance"),
            notification_token=str(data.get("notification_token") or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "msisdn": self.msisdn,
            "wmt_mfs": self.wmt_mfs,
            "agent_id": self.agent_id,
            "name": self.name,
            "balance": self.balance,
            "notification_token": self.notification_token,
            "device": {
                "deviceid": self.device.deviceid,
                "fingerprint": self.device.fingerprint,
                "device": self.device.device,
                "manufacturer": self.device.manufacturer,
                "model": self.device.model,
                "product": self.device.product,
                "osversion": self.device.osversion,
                "cpuabi": self.device.cpuabi,
                "appid": self.device.appid,
                "appversion": self.device.appversion,
                "versioncode": self.device.versioncode,
                "userlanguage": self.device.userlanguage,
            },
        }


class WaveClient:
    def __init__(
        self,
        session: WaveSession,
        *,
        timeout: float = 30.0,
        proxy: str | None = None,
        verify_ssl: bool = True,
    ):
        self.session = session
        self.http = requests.Session()
        self.http.trust_env = False
        if proxy:
            self.http.proxies.update({"http": proxy, "https": proxy})
        self.http.verify = verify_ssl
        self.timeout = timeout

    def _url(self, path: str) -> str:
        return f"{BASE_URL}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        data: dict | str | None = None,
        json_body: Any = None,
        authed: bool = False,
        accept_json: bool = False,
        client: str = "okhttp",
        extra_headers: dict | None = None,
    ) -> requests.Response:
        headers = self.session.device.headers(
            wmt_mfs=self.session.wmt_mfs if authed else None,
            accept_json=accept_json,
            client=client,
        )
        if extra_headers:
            headers.update(extra_headers)
        headers["appId"] = OFFICIAL_APP_ID
        for k in list(headers):
            if k.lower() == "x-requested-with":
                headers[k] = OFFICIAL_APP_ID
        lower = {k.lower() for k in headers}
        if data is not None and "content-type" not in lower:
            headers["content-type"] = "application/x-www-form-urlencoded"
        if json_body is not None:
            headers["content-type"] = "application/json; charset=UTF-8"
        body = data
        if isinstance(data, dict):
            body = urlencode(data)
        resp = self.http.request(
            method,
            self._url(path),
            params=params,
            data=body,
            json=json_body,
            headers=headers,
            timeout=self.timeout,
        )
        tok = resp.headers.get("wmt-mfs")
        if tok:
            self.session.wmt_mfs = tok
        return resp

    def register_customer(self, msisdn: str, country_code: str = "+95") -> dict:
        r = self._request(
            "POST",
            "/v3/wmt-mfs-otp/register-customer",
            data={"msisdn": msisdn, "countryCode": country_code},
        )
        try:
            return r.json()
        except Exception:
            return {"status_code": r.status_code, "text": r.text}

    def generate_otp(self, msisdn: str) -> dict:
        r = self._request(
            "GET",
            "/v3/wmt-mfs-otp/generate-otp",
            params={"msisdn": msisdn},
            accept_json=True,
        )
        r.raise_for_status()
        return r.json()

    def confirm_otp(self, msisdn: str, otp: str) -> dict:
        r = self._request(
            "POST",
            "/v3/wmt-mfs-otp/confirm-otp",
            data={"msisdn": msisdn, "otp": otp},
            accept_json=True,
        )
        r.raise_for_status()
        return r.json()

    def security_token(self) -> str:
        r = self._request("GET", "/v3/wmt-mfs-otp/security-token")
        r.raise_for_status()
        data = r.json()
        counter = (data.get("responseMap") or {}).get("securityCounter")
        if not counter:
            raise RuntimeError(f"No securityCounter in response: {data}")
        return str(counter)

    def login(self, msisdn: str, pin: str) -> dict:
        """Full PIN login: two security-token fetches → RSA(pin:counter) × 2 → login."""
        c1 = self.security_token()
        password = encrypt_pin_token(pin, c1)
        c2 = self.security_token()
        pin_enc = encrypt_pin_token(pin, c2)
        r = self._request(
            "POST",
            "/v3/mfs-customer/login",
            data={"msisdn": msisdn, "password": password, "pin": pin_enc},
            accept_json=True,
            extra_headers={"notificationtrackingid": "noti"},
        )
        r.raise_for_status()
        body = r.json()
        self.session.msisdn = msisdn
        rm = body.get("responseMap") or {}
        self.session.agent_id = rm.get("agentId")
        sub = rm.get("subscriberDetails") or {}
        self.session.name = str(sub.get("name") or "")
        if not self.session.wmt_mfs:
            raise RuntimeError("Login OK but no wmt-mfs response header")
        return body

    def wallet_balance(self) -> dict:
        r = self._request("GET", "/v2/mfs-customer/wallet-balance", authed=True)
        r.raise_for_status()
        body = r.json()
        bal = (body.get("responseMap") or {}).get("balance")
        if bal is not None:
            self.session.balance = float(bal)
        return body

    def get_kyc_info(self) -> dict:
        r = self._request("GET", "/v2/mfs-customer/get-kyc-info", authed=True)
        r.raise_for_status()
        return r.json()

    def check_beneficiary(self, receiver_msisdn: str) -> dict:
        digits = _norm_msisdn(receiver_msisdn)
        r = self._request(
            "POST",
            "/v2/mfs-customer/check-mfs-beneficiary",
            json_body={"msisdn": digits},
            authed=True,
            client="dart",
        )
        r.raise_for_status()
        return r.json()

    def send_money_fee(self, amount: float | int | str) -> dict:
        r = self._request(
            "GET",
            "/v2/mfs-customer/send-money-fee",
            params={"amount": str(float(amount))},
            authed=True,
            client="dart",
        )
        r.raise_for_status()
        return r.json()

    def send_money_ma(
        self,
        *,
        receiver_msisdn: str,
        receiver_name: str,
        amount: float | int | str,
        pin: str,
        sender_name: str | None = None,
        note: str = "",
    ) -> dict:
        """P2P Wave→Wave (MA). PIN = RSA(pin:securityCounter) once."""
        if not self.session.wmt_mfs:
            raise RuntimeError("Need wmt_mfs — login first")
        recv = _norm_msisdn(receiver_msisdn)
        sender = sender_name or self.session.name or ""
        counter = self.security_token()
        pin_enc = encrypt_pin_token(pin, counter)
        r = self._request(
            "POST",
            "/v2/mfs-customer/send-money-ma",
            data={
                "receiverName": receiver_name,
                "senderName": sender,
                "receiverMsisdn": recv,
                "amount": str(float(amount)),
                "pin": pin_enc,
                "note": note,
            },
            authed=True,
            client="dart",
        )
        r.raise_for_status()
        return r.json()

    def tnx_histories(self, *, limit: int = 20, offset: int = 0) -> dict:
        r = self._request(
            "GET",
            "/v3/mfs-customer/tnxhistory-utility/v2/tnx-histories",
            params={"limit": str(limit), "offset": str(offset)},
            authed=True,
            client="history",
            extra_headers={"content-type": "application/json"},
        )
        r.raise_for_status()
        return r.json()

    def tnx_history_detail(self, trans_id: str, trans_date: str) -> dict:
        r = self._request(
            "GET",
            "/v3/mfs-customer/tnxhistory-utility/tnx-history-detail",
            params={"transId": str(trans_id), "transDate": trans_date},
            authed=True,
            client="history",
            extra_headers={"content-type": "application/json"},
        )
        r.raise_for_status()
        return r.json()

    def full_login(
        self,
        msisdn: str,
        otp: str,
        pin: str,
        *,
        skip_register: bool = True,
    ) -> dict:
        """OTP confirm → PIN login. Caller should already have requested OTP."""
        digits = _norm_msisdn(msisdn)
        if not skip_register:
            self.register_customer(digits)
        conf = self.confirm_otp(digits, otp)
        auth = self.login(digits, pin)
        return {"confirm_otp": conf, "login": auth, "wmt_mfs_len": len(self.session.wmt_mfs)}


def load_session(path: Path | str) -> WaveSession | None:
    p = Path(path)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return WaveSession.from_dict(data)


def save_session(path: Path | str, session: WaveSession) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(
        json.dumps(session.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    tmp.replace(p)
