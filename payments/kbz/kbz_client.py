"""KBZ Pay HTTP client — NewTransRecordList and related commands."""

from __future__ import annotations

import base64
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

from .kbz_crypto import build_encrypted_request, decrypt_response_body, encrypt_pin

API_URL = "https://app.kbzpay.com:9002/api/interface/version1.3/customer"
DEFAULT_VERSION = "5.8.5"


def kbz_http_session() -> requests.Session:
    """Direct KBZ API calls — bypass macOS/Reqable system proxy (127.0.0.1:9000)."""
    session = requests.Session()
    session.trust_env = False
    return session
PAGE_COUNT = 10
# TopUpActivity + BsConstants
BUY_AIRTIME = "OnlinePaymentforBuyAirtime"
BUY_DATA_PACK = "BuyDataPack"
# Macle top-up miniapp (MaGetToken.getAppToken → PGWGetAccessToken → autologin)
TOPUP_MINIAPP_ID = "33abba0ac0c73a86ad3bb9fb1e7e99ae"
TOPUP_MINIAPP_MERCH_APPID = "kpc44dcebfeb5e1a741c4a03d38ac90b"


def _normalize_mmk_amount(value: str) -> str:
    """API returns FinalPrice as '1000.0'; legacy AirtimeTopUp rejects PaymentAmount with '.0'."""
    s = str(value).strip()
    if not s:
        return s
    try:
        num = float(s)
        if num.is_integer():
            return str(int(num))
    except ValueError:
        pass
    return s


@dataclass
class KBZSession:
    token: str
    device_id: str
    msisdn: str
    imei: str
    version: str = DEFAULT_VERSION
    language: str = "en"
    platform: str = "Android"
    encoding: str = "unicode"
    device_token: str = ""
    device_version: str = "31"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> KBZSession:
        profile = data.get("deviceProfile") or {}
        return cls(
            token=str(data["token"]),
            device_id=str(data.get("deviceID") or data.get("device_id")),
            msisdn=str(data.get("initiatorMSISDN") or data.get("msisdn")),
            imei=str(data["imei"]),
            version=str(data.get("version", DEFAULT_VERSION)),
            language=str(data.get("language", "en")),
            device_token=str(profile.get("deviceToken") or data.get("deviceToken") or ""),
            device_version=str(data.get("deviceVersion") or profile.get("deviceVersion") or "31"),
        )

    def to_dict(self) -> dict[str, str]:
        return {
            "token": self.token,
            "deviceID": self.device_id,
            "initiatorMSISDN": self.msisdn,
            "imei": self.imei,
            "version": self.version,
            "language": self.language,
            "platform": self.platform,
            "encoding": self.encoding,
        }


def load_session(path: Path) -> KBZSession | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and data.get("token"):
        return KBZSession.from_dict(data)
    return None


def token_issued_ms(token: str) -> int | None:
    suffix = token[-13:]
    return int(suffix) if suffix.isdigit() else None


def extract_latest_token_from_log(log_path: Path) -> str | None:
    """Newest token from Frida/Reqable plaintext lines (suffix timestamp)."""
    if not log_path.exists():
        return None
    best_ts = -1
    best_token: str | None = None
    pat = re.compile(r'"token"\s*:\s*"([^"]+)"')
    for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if '"token"' not in line:
            continue
        for token in pat.findall(line):
            issued = token_issued_ms(token)
            if issued is not None and issued > best_ts:
                best_ts = issued
                best_token = token
    return best_token


def extract_session_from_log(log_path: Path) -> KBZSession | None:
    if not log_path.exists():
        return None
    best: dict[str, Any] | None = None
    pat = re.compile(
        r'\{[^{}]*"commandId"\s*:\s*"NewTransRecordList"[^{}]*"token"\s*:\s*"[^"]+"[^{}]*\}'
    )
    for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "NewTransRecordList" not in line or '"token"' not in line:
            continue
        m = pat.search(line)
        if not m:
            continue
        try:
            obj = json.loads(m.group())
        except json.JSONDecodeError:
            continue
        if obj.get("token") and obj.get("deviceID"):
            best = obj
    return KBZSession.from_dict(best) if best else None


def save_session(path: Path, session: KBZSession) -> None:
    path.write_text(json.dumps(session.to_dict(), indent=2) + "\n", encoding="utf-8")


@dataclass
class HistoryCursor:
    order_id: str = ""
    trade_time_ms: int = 0
    pages_fetched: int = 0

    def apply_page(self, records: list[dict]) -> None:
        self.pages_fetched += 1
        if records:
            last = records[-1]
            self.order_id = str(last.get("orderId", ""))
            self.trade_time_ms = int(last.get("tradeTime", 0))


class KBZClient:
    def __init__(self, session: KBZSession, *, timeout: float = 30.0) -> None:
        self.session = session
        self.timeout = timeout
        self._http = kbz_http_session()
        self._http.headers.update({"User-Agent": "KBZPay-Android/5.8.5"})

    def _history_payload(self, *, cursor: HistoryCursor, need_total: bool) -> dict[str, Any]:
        """Field order matches the Android app (affects nothing server-side; kept for parity)."""
        first_page = cursor.pages_fetched == 0
        payload: dict[str, Any] = {
            "count": PAGE_COUNT,
            "direction": "",
            "filterTypes": [],
            "fromDate": 0,
            "isHomePage": "false",
            "maxAmount": "",
            "minAmount": "",
            "needTotalAmount": need_total if first_page else False,
            "oppositeMsisdn": "",
            "oppositePartyId": "",
            "oppositeShortCode": "",
            "startNum": 0,
            "toDate": 0,
            "commandId": "NewTransRecordList",
            "deviceID": self.session.device_id,
            "encoding": self.session.encoding,
            "imei": self.session.imei,
            "initiatorMSISDN": self.session.msisdn,
            "language": self.session.language,
            "originatorConversationID": str(uuid.uuid4()),
            "platform": self.session.platform,
            "timestamp": str(int(time.time() * 1000)),
            "token": self.session.token,
            "version": self.session.version,
        }
        if not first_page and cursor.order_id:
            payload["orderId"] = cursor.order_id
            payload["tradeTime"] = str(cursor.trade_time_ms)
        return payload

    def _decrypt_http_response(self, resp: requests.Response, enc: Any) -> dict[str, Any]:
        raw_body = resp.text.strip()
        is_enc = resp.headers.get("isEncrypt", "").lower()
        if is_enc in ("true", "1", "yes"):
            try:
                plain = decrypt_response_body(raw_body, enc.key_b64, enc.iv_hex, is_encrypt="true")
                return json.loads(plain)
            except Exception as exc:
                raise RuntimeError(
                    f"Failed to decrypt response (HTTP {resp.status_code}): {raw_body[:200]}"
                ) from exc
        try:
            return json.loads(raw_body)
        except json.JSONDecodeError as exc:
            resp.raise_for_status()
            raise RuntimeError(f"Invalid JSON response: {raw_body[:200]}") from exc

    def _unwrap_legacy_response(self, data: dict[str, Any]) -> dict[str, Any]:
        if "responseCode" in data:
            self._check_new_response(data, http_status=200)
            return data
        if "Response" not in data:
            return data
        body = (data.get("Response") or {}).get("Body") or {}
        code = str(body.get("ResponseCode", ""))
        desc = str(body.get("ResponseDesc", ""))
        if code and code not in ("0", ""):
            raise RuntimeError(f"API {code}: {desc}")
        detail = body.get("ResponseDetail") or {}
        if isinstance(detail, str):
            try:
                detail = json.loads(detail)
            except json.JSONDecodeError:
                detail = {"raw": detail}
        if isinstance(detail, dict):
            result_code = str(detail.get("ResultCode", ""))
            if result_code and result_code not in ("0", ""):
                raise RuntimeError(
                    f"API {result_code}: {detail.get('ResultDesc', desc)}"
                )
        return detail if isinstance(detail, dict) else {"raw": detail}

    def _check_new_response(self, data: dict[str, Any], *, http_status: int) -> None:
        code = str(data.get("responseCode", ""))
        if code in ("0", ""):
            return
        desc = str(data.get("responseDesc", data))
        if code == "-1" and "maintenance" in desc.lower():
            raise RuntimeError(
                "API rejected request (often stale token or crypto mismatch). "
                f"Refresh token from phone (menu 3) or frida_kbz.log. Server: {desc}"
            )
        if http_status >= 400:
            raise RuntimeError(f"HTTP {http_status}: {desc}")
        raise RuntimeError(f"API {code}: {desc}")

    def _post_raw(
        self,
        command_id: str,
        plaintext: str,
        *,
        message_type_new: bool = True,
    ) -> dict[str, Any]:
        enc = build_encrypted_request(
            plaintext,
            command_id=command_id,
            version=self.session.version,
            message_type_new=message_type_new,
        )
        headers = dict(enc.headers)
        headers["KBZPay-Command-Id"] = command_id
        headers["KBZPay-Version"] = self.session.version
        resp = self._http.post(API_URL, headers=headers, data=enc.body, timeout=self.timeout)
        return self._decrypt_http_response(resp, enc)

    def _post_command(self, command_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        data = self._post_raw(command_id, plaintext, message_type_new=True)
        self._check_new_response(data, http_status=200)
        return data

    def _legacy_header(
        self,
        command_id: str,
        *,
        conversation_id: str,
        timestamp_ms: str,
        use_dynamic_caller: str | None = None,
    ) -> dict[str, Any]:
        header: dict[str, Any] = {
            "CommandID": command_id,
            "Version": self.session.version,
            "ClientType": "Android",
            "DeviceID": self.session.device_id,
            "Imei": self.session.imei,
            "DeviceVersion": self.session.device_version,
            "KeyOwner": "",
            "Timestamp": timestamp_ms,
            "Language": self.session.language,
            "Caller": {"CallerType": "2", "ThirdPartyID": "1", "Password": ""},
            "DeviceToken": self.session.device_token,
            "OriginatorConversationID": conversation_id,
        }
        if command_id != "Register":
            header["Token"] = self.session.token
        if use_dynamic_caller is not None:
            header["UseDynamicCaller"] = use_dynamic_caller
        return header

    def _post_legacy_command(
        self,
        command_id: str,
        *,
        request_detail: dict[str, Any],
        initiator: dict[str, Any],
        receiver_party: dict[str, Any] | None = None,
        use_dynamic_caller: str | None = None,
        conversation_id: str | None = None,
        timestamp_ms: str | None = None,
    ) -> dict[str, Any]:
        conv = conversation_id or str(uuid.uuid4())
        ts = timestamp_ms or str(int(time.time() * 1000))
        identity: dict[str, Any] = {"Initiator": initiator}
        if receiver_party is None:
            identity["ReceiverParty"] = {
                "Identifier": self.session.msisdn,
                "IdentifierType": "1",
            }
        else:
            identity["ReceiverParty"] = receiver_party
        payload = {
            "Request": {
                "Header": self._legacy_header(
                    command_id,
                    conversation_id=conv,
                    timestamp_ms=ts,
                    use_dynamic_caller=use_dynamic_caller,
                ),
                "Body": {
                    "Identity": identity,
                    "RequestDetail": request_detail,
                },
            }
        }
        plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        data = self._post_raw(command_id, plaintext, message_type_new=False)
        return self._unwrap_legacy_response(data)

    def _base_new_request(self, command_id: str) -> dict[str, Any]:
        return {
            "commandId": command_id,
            "deviceID": self.session.device_id,
            "encoding": self.session.encoding,
            "imei": self.session.imei,
            "initiatorMSISDN": self.session.msisdn,
            "language": self.session.language,
            "originatorConversationID": str(uuid.uuid4()),
            "platform": self.session.platform,
            "timestamp": str(int(time.time() * 1000)),
            "token": self.session.token,
            "version": self.session.version,
        }

    @staticmethod
    def _miniapp_pay_method(method: dict[str, Any]) -> dict[str, Any]:
        """PayOrder.MINIAPP payMethod object (matches CheckoutUtil.startPay)."""
        return {
            "alpha": 1.0,
            "available": method.get("available", "true"),
            "displayIcon": method.get("displayIcon", ""),
            "displayInfo": method.get("displayInfo", "Balance"),
            "isSelect": True,
            "odActivate": False,
            "payMethod": method.get("payMethod", "PAY_BY_WALLET"),
            "selected": "true",
            "supplementInfo": method.get("supplementInfo", ""),
        }

    @staticmethod
    def _default_geo() -> tuple[str, str]:
        return ("17.00", "96.09")

    @staticmethod
    def _pick_wallet_pay_method(methods: list[dict[str, Any]]) -> dict[str, Any] | None:
        for method in methods:
            if method.get("payMethod") == "PAY_BY_WALLET" and method.get("available", "true") == "true":
                return method
        for method in methods:
            if method.get("available", "true") == "true":
                return method
        return methods[0] if methods else None

    def get_user_info(self, msisdn: str) -> dict[str, Any]:
        """GetUserInfo — resolve KBZ Pay account name for a phone number (TransferActivity)."""
        initiator = {
            "Identifier": self.session.msisdn,
            "IdentifierType": "1",
        }
        return self._post_legacy_command(
            "GetUserInfo",
            request_detail={"Msisdn": msisdn},
            initiator=initiator,
        )

    def get_picture(self, file_id: str) -> bytes:
        """GetPicture — download profile/avatar image bytes (legacy; response is raw JPEG/PNG)."""
        file_id = str(file_id).replace("&amp;", "&").strip()
        if not file_id:
            raise ValueError("file_id required for GetPicture")
        conv = str(uuid.uuid4())
        ts = str(int(time.time() * 1000))
        initiator = {
            "Identifier": self.session.msisdn,
            "IdentifierType": "1",
        }
        payload = {
            "Request": {
                "Header": self._legacy_header(
                    "GetPicture", conversation_id=conv, timestamp_ms=ts
                ),
                "Body": {
                    "Identity": {
                        "Initiator": initiator,
                        "ReceiverParty": {
                            "Identifier": self.session.msisdn,
                            "IdentifierType": "1",
                        },
                    },
                    "RequestDetail": {
                        "Encoding": "unicode",
                        "fileId": file_id,
                        "isLiveDb": False,
                    },
                },
            }
        }
        plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        enc = build_encrypted_request(
            plaintext,
            command_id="GetPicture",
            version=self.session.version,
            message_type_new=False,
        )
        headers = dict(enc.headers)
        headers["KBZPay-Command-Id"] = "GetPicture"
        headers["KBZPay-Version"] = self.session.version
        resp = self._http.post(API_URL, headers=headers, data=enc.body, timeout=self.timeout)
        if resp.status_code >= 400:
            raise RuntimeError(f"GetPicture HTTP {resp.status_code}")
        raw = resp.content
        if not raw:
            raise RuntimeError("GetPicture returned empty body")
        is_enc = resp.headers.get("isEncrypt", "").lower() in ("true", "1", "yes")
        if is_enc:
            plain = decrypt_response_body(
                resp.text, enc.key_b64, enc.iv_hex, is_encrypt="true"
            )
            try:
                data = json.loads(plain)
            except json.JSONDecodeError:
                raw = plain.encode("utf-8") if isinstance(plain, str) else plain
            else:
                for key in ("Picture", "picture", "fileContent", "content", "data"):
                    val = data.get(key)
                    if isinstance(val, str) and val:
                        return base64.b64decode(val)
                raise RuntimeError(f"GetPicture encrypted response missing image: {plain[:200]}")
        if raw[:3] in (b"\xff\xd8\xff", b"\x89PN"):
            return raw
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return raw
        for key in ("Picture", "picture", "fileContent", "content", "data"):
            val = data.get(key)
            if isinstance(val, str) and val:
                return base64.b64decode(val)
        raise RuntimeError(f"GetPicture unexpected response: {raw[:120]!r}")

    def pgw_get_merch_access_token(
        self,
        *,
        merch_app_id: str = TOPUP_MINIAPP_MERCH_APPID,
        mini_app_id: str = TOPUP_MINIAPP_ID,
        trade_type: str = "MINIAPP",
    ) -> str:
        """PGWGetAccessToken — macle MaGetToken.getAppToken() (legacy envelope)."""
        conv = str(uuid.uuid4())
        ts = str(int(time.time() * 1000))
        payload = {
            "Request": {
                "Header": self._legacy_header(
                    "PGWGetAccessToken", conversation_id=conv, timestamp_ms=ts
                ),
                "Body": {
                    "RequestDetail": {
                        "Merch_APPID": merch_app_id,
                        "MiniAppId": mini_app_id,
                        "TradeType": trade_type,
                        "IsGuest": "false",
                    },
                    "Identity": {
                        "Initiator": {
                            "Identifier": self.session.msisdn,
                            "IdentifierType": "1",
                        },
                        "ReceiverParty": {"IdentifierType": "1"},
                    },
                },
            }
        }
        plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        data = self._post_raw("PGWGetAccessToken", plaintext, message_type_new=False)
        detail = (data.get("Response") or {}).get("Body", {}).get("ResponseDetail") or {}
        code = str(detail.get("ResultCode", detail.get("ResponseCode", "")))
        if code not in ("0", ""):
            raise RuntimeError(
                f"PGWGetAccessToken {code}: {detail.get('ResultDesc', detail)}"
            )
        token = str(detail.get("Merch_Access_Token") or "")
        if not token:
            raise RuntimeError("PGWGetAccessToken returned no Merch_Access_Token")
        return token

    def precheckout_transfer(
        self,
        *,
        receiver_msisdn: str,
        amount: str,
        note: str,
    ) -> dict[str, Any]:
        payload = self._base_new_request("PreCheckout.TransferToAccount")
        payload.update(
            {
                "amount": str(amount),
                "receiverMSISDN": receiver_msisdn,
                "note": note,
                "supportMultiPayMethod": "true",
            }
        )
        return self._post_command("PreCheckout.TransferToAccount", payload)

    def pay_transfer(
        self,
        *,
        receiver_msisdn: str,
        amount: str,
        note: str,
        pin: str,
        prepay_id: str,
        pay_method: dict[str, Any],
        additional_param: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        payload = self._base_new_request("PayOrder.TransferToAccount")
        payload.update(
            {
                "initiatorPin": encrypt_pin(
                    pin, payload["timestamp"], payload["originatorConversationID"]
                ),
                "useDynamicCaller": "true",
                "prepayId": prepay_id,
                "payMethod": pay_method,
                "receiverMSISDN": receiver_msisdn,
                "extendParams": {"transNote": note, "amount": str(amount)},
            }
        )
        if additional_param:
            payload["additionalParam"] = additional_param
        return self._post_command("PayOrder.TransferToAccount", payload)

    def transfer_to_account(
        self,
        *,
        receiver_msisdn: str,
        amount: str,
        note: str,
        pin: str,
    ) -> dict[str, Any]:
        preview = self.precheckout_transfer(
            receiver_msisdn=receiver_msisdn, amount=amount, note=note
        )
        methods = preview.get("availablePayMethods") or []
        pay_method = self._pick_wallet_pay_method(methods)
        if not pay_method:
            raise RuntimeError("No available pay method in pre-checkout response")
        prepay_id = str(preview.get("prepayId", ""))
        if not prepay_id:
            raise RuntimeError("Pre-checkout did not return prepayId")
        return self.pay_transfer(
            receiver_msisdn=receiver_msisdn,
            amount=amount,
            note=note,
            pin=pin,
            prepay_id=prepay_id,
            pay_method=pay_method,
        )

    def fetch_airtime_price_list(self) -> dict[str, Any]:
        """App uses legacy Request envelope (protocol v1, no MessageType: NEW)."""
        initiator = {
            "Identifier": self.session.msisdn,
            "IdentifierType": "1",
        }
        return self._post_legacy_command(
            "GetAirtimePriceList",
            request_detail={},
            initiator=initiator,
        )

    def scan_qr_code2(self, qr_code: str, *, scan_source: str = "Terminal") -> dict[str, Any]:
        """ScanQRCode2 — same API the app uses when scanning any QR."""
        initiator = {
            "Identifier": self.session.msisdn,
            "IdentifierType": "1",
        }
        return self._post_legacy_command(
            "ScanQRCode2",
            request_detail={
                "Encoding": "unicode",
                "QrCode": qr_code,
                "isLiveDb": False,
                "ScanSource": scan_source,
            },
            initiator=initiator,
            receiver_party={
                "Identifier": self.session.msisdn,
                "IdentifierType": "1",
            },
        )

    def fetch_trans_record_detail(
        self,
        *,
        trans_no: str,
        debit_or_credit: str = "D",
    ) -> dict[str, Any]:
        """NewTransRecordDetail — receipt detail for transactions on your account."""
        last_err: RuntimeError | None = None
        tried: list[str] = []
        preferred = debit_or_credit.upper()
        if preferred.startswith("C"):
            order = ("C", "D")
        else:
            order = ("D", "C")
        for dc in order:
            if dc in tried:
                continue
            tried.append(dc)
            payload = self._base_new_request("NewTransRecordDetail")
            payload.update(
                {
                    "transNo": trans_no,
                    "debitOrCredit": dc,
                    "receiverMSISDN": self.session.msisdn,
                }
            )
            try:
                return self._post_command("NewTransRecordDetail", payload)
            except RuntimeError as exc:
                last_err = exc
                if "AS1002" not in str(exc):
                    raise
        if last_err:
            raise last_err
        raise RuntimeError("NewTransRecordDetail failed")

    def calculate_topup_fee(
        self,
        *,
        business_service: str,
        operator_name: str,
        amount: str,
        discount_id: str = "1",
    ) -> dict[str, Any]:
        """NewCalculateFee — TopUpActivity.next() before legacy pay."""
        payload = self._base_new_request("NewCalculateFee")
        payload.update(
            {
                "businessService": business_service,
                "amount": str(amount),
                "receiverShortCode": operator_name,
                "discountId": discount_id,
            }
        )
        return self._post_command("NewCalculateFee", payload)

    def precheckout_airtime(
        self,
        *,
        operator_name: str,
        recharge_msisdn: str,
        price: str,
        pack_item_id: str | None = None,
    ) -> dict[str, Any]:
        """PreCheckout.OnlinePaymentforBuyAirtime — miniapp airtime/package pre-checkout."""
        cmd = f"PreCheckout.{BUY_AIRTIME}"
        payload = self._base_new_request(cmd)
        item_id = str(pack_item_id if pack_item_id is not None else price)
        payload.update(
            {
                "amount": str(price),
                "receiverShortCode": operator_name,
                "supportMultiPayMethod": "true",
                "extendParams": {
                    "telecomOperator": operator_name,
                    "rechargedMsisdn": recharge_msisdn,
                    "packItemId": item_id,
                },
            }
        )
        return self._post_command(cmd, payload)

    def checkout_topup_miniapp(
        self,
        *,
        prepay_id: str,
        raw_request: str,
    ) -> dict[str, Any]:
        """Checkout — miniapp checkout screen (tradeType MINIAPP)."""
        cmd = "Checkout"
        payload = self._base_new_request(cmd)
        payload.update(
            {
                "prepayId": prepay_id,
                "rawRequest": raw_request,
                "supportMultiPayMethod": "true",
                "tradeType": "MINIAPP",
            }
        )
        return self._post_command(cmd, payload)

    def pay_topup_miniapp(
        self,
        *,
        pin: str,
        prepay_id: str,
        pay_method: dict[str, Any],
        latitude: str | None = None,
        longitude: str | None = None,
    ) -> dict[str, Any]:
        """PayOrder.MINIAPP — CheckoutUtil.startPay() for airtime top-up."""
        cmd = "PayOrder.MINIAPP"
        payload = self._base_new_request(cmd)
        lat, lon = self._default_geo()
        if latitude is not None:
            lat = latitude
        if longitude is not None:
            lon = longitude
        payload.update(
            {
                "additionalParam": {},
                "extendParams": {},
                "initiatorPin": encrypt_pin(
                    pin, payload["timestamp"], payload["originatorConversationID"]
                ),
                "useDynamicCaller": "true",
                "prepayId": prepay_id,
                "payMethod": pay_method,
                "referenceData": {"authType": "PIN", "qrOrigin": ""},
                "latitude": lat,
                "longitude": lon,
            }
        )
        return self._post_command(cmd, payload)

    def checkout_airtime(
        self,
        *,
        prepay_id: str,
        raw_request: str,
        pay_method: dict[str, Any] | None = None,
        coupon: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Alias for checkout_topup_miniapp (legacy name)."""
        return self.checkout_topup_miniapp(prepay_id=prepay_id, raw_request=raw_request)

    def pay_airtime_order(
        self,
        *,
        pin: str,
        prepay_id: str,
        pay_method: dict[str, Any] | None = None,
        coupon: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Alias for pay_topup_miniapp (legacy name)."""
        if not pay_method:
            raise RuntimeError("pay_method required for PayOrder.MINIAPP")
        return self.pay_topup_miniapp(pin=pin, prepay_id=prepay_id, pay_method=pay_method)

    def airtime_topup_legacy(
        self,
        *,
        operator_name: str,
        recharge_msisdn: str,
        price: str,
        final_price: str,
        pin: str,
        discount_id: str = "",
    ) -> dict[str, Any]:
        """Legacy AirtimeTopUp — TopUpActivity.lambda$next$5 (VERSION_OLD)."""
        self.calculate_topup_fee(
            business_service="AirtimeTopUp",
            operator_name=operator_name,
            amount=price,
        )
        conv = str(uuid.uuid4())
        ts = str(int(time.time() * 1000))
        initiator = {
            "Identifier": self.session.msisdn,
            "IdentifierType": "1",
            "SecurityCredential": encrypt_pin(pin, ts, conv),
        }
        # App uses OperatorName (e.g. U9) for ReceiverParty + TelecomOperator, not ShortCode.
        receiver_party = {
            "Identifier": operator_name,
            "IdentifierType": "4",
        }
        amount = _normalize_mmk_amount(price)
        payment_amount = _normalize_mmk_amount(final_price)
        request_detail: dict[str, Any] = {
            "discountId": discount_id,
            "TelecomOperator": operator_name,
            "Amount": amount,
            "PaymentAmount": payment_amount,
            "TotalAmount": amount,
            "RechargedMSISDN": recharge_msisdn,
        }
        return self._post_legacy_command(
            "AirtimeTopUp",
            request_detail=request_detail,
            initiator=initiator,
            receiver_party=receiver_party,
            use_dynamic_caller="true",
            conversation_id=conv,
            timestamp_ms=ts,
        )

    def datapack_purchase_legacy(
        self,
        *,
        operator_name: str,
        recharge_msisdn: str,
        price: str,
        pack_item_id: str,
        pin: str,
        discount_id: str = "",
    ) -> dict[str, Any]:
        """Legacy DataPackPurchase — TopUpActivity.lambda$next$4 (VERSION_OLD)."""
        self.calculate_topup_fee(
            business_service="DataPackPurchase",
            operator_name=operator_name,
            amount=price,
        )
        conv = str(uuid.uuid4())
        ts = str(int(time.time() * 1000))
        initiator = {
            "Identifier": self.session.msisdn,
            "IdentifierType": "1",
            "SecurityCredential": encrypt_pin(pin, ts, conv),
        }
        receiver_party = {
            "Identifier": operator_name,
            "IdentifierType": "4",
        }
        request_detail: dict[str, Any] = {
            "discountId": discount_id,
            "TelecomOperator": operator_name,
            "Amount": _normalize_mmk_amount(price),
            "PackItemId": str(pack_item_id),
            "RechargedMSISDN": recharge_msisdn,
        }
        return self._post_legacy_command(
            "DataPackPurchase",
            request_detail=request_detail,
            initiator=initiator,
            receiver_party=receiver_party,
            use_dynamic_caller="true",
            conversation_id=conv,
            timestamp_ms=ts,
        )

    def airtime_topup_from_prepay(
        self,
        *,
        prepay_id: str,
        raw_request: str,
        pin: str,
    ) -> dict[str, Any]:
        """Checkout → PayOrder.MINIAPP when the macle miniapp already created the order."""
        prepay_id = str(prepay_id or "").strip()
        raw_request = str(raw_request or "").strip()
        if not prepay_id or not raw_request:
            raise RuntimeError("prepayId and rawRequest are required.")
        checkout = self.checkout_topup_miniapp(prepay_id=prepay_id, raw_request=raw_request)
        methods = checkout.get("availablePayMethods") or []
        wallet = self._pick_wallet_pay_method(methods)
        if not wallet:
            raise RuntimeError("No available wallet pay method in checkout response.")
        return self.pay_topup_miniapp(
            pin=pin,
            prepay_id=prepay_id,
            pay_method=self._miniapp_pay_method(wallet),
        )

    def airtime_topup_via_miniapp(
        self,
        *,
        operator_name: str,
        recharge_msisdn: str,
        price: str,
        product_id: str,
        pin: str,
    ) -> dict[str, Any]:
        """miniapp-run order create → Checkout → PayOrder.MINIAPP (gadget-free)."""
        from kbz_miniapp_client import KBZMiniappClient

        product_id = str(product_id or "").strip()
        if not product_id:
            raise ValueError("product_id is required for miniapp top-up")
        merch_token = self.pgw_get_merch_access_token(
            merch_app_id=TOPUP_MINIAPP_MERCH_APPID,
            mini_app_id=TOPUP_MINIAPP_ID,
            trade_type="MINIAPP",
        )
        miniapp = KBZMiniappClient(
            account_msisdn=self.session.msisdn,
            app_version=self.session.version,
        )
        miniapp.miniapp_login(merch_token, phone=self.session.msisdn)
        order = miniapp.create_airtime_order(
            operator_name=operator_name,
            recharge_msisdn=recharge_msisdn,
            amount=price,
            product_id=product_id,
        )
        return self.airtime_topup_from_prepay(
            prepay_id=order.prepay_id,
            raw_request=order.raw_request,
            pin=pin,
        )

    def airtime_topup(
        self,
        *,
        operator_name: str,
        recharge_msisdn: str,
        price: str,
        final_price: str,
        pin: str,
        discount_id: str = "",
        pack_item_id: str | None = None,
        product_id: str | None = None,
    ) -> dict[str, Any]:
        """Terminal top-up — miniapp-run order → Checkout (MINIAPP) → PayOrder.MINIAPP."""
        del discount_id, final_price  # miniapp flow uses server-side pricing
        resolved_product = str(product_id or pack_item_id or "").strip()
        if not resolved_product:
            raise ValueError(
                "product_id (GetAirtimePriceList itemId) is required for miniapp top-up"
            )
        return self.airtime_topup_via_miniapp(
            operator_name=operator_name,
            recharge_msisdn=recharge_msisdn,
            price=price,
            product_id=resolved_product,
            pin=pin,
        )

    def fetch_monthly_statistics(
        self,
        *,
        transaction_types: list[str] | None = None,
    ) -> dict[str, Any]:
        """QueryOrderMonthlyStatistics — monthly income/expense (app history screen)."""
        payload = self._base_new_request("QueryOrderMonthlyStatistics")
        payload["transactionTypes"] = list(transaction_types or [])
        return self._post_command("QueryOrderMonthlyStatistics", payload)

    def fetch_transaction_page(
        self,
        *,
        cursor: HistoryCursor | None = None,
        need_total: bool | None = None,
    ) -> dict[str, Any]:
        cursor = cursor or HistoryCursor()
        need = True if need_total is None else need_total
        if cursor.pages_fetched > 0:
            need = False
        payload = self._history_payload(cursor=cursor, need_total=need)
        data = self._post_command("NewTransRecordList", payload)
        return data

    def _balance_payload(self) -> dict[str, Any]:
        """CustomerCombineQuery — Balance + ExchangeRate (home screen)."""
        return {
            "queryAccountBalanceRequest": {"queryBalanceFlag": "false"},
            "queryContent": ["Balance", "ExchangeRate"],
            "commandId": "CustomerCombineQuery",
            "deviceID": self.session.device_id,
            "encoding": self.session.encoding,
            "imei": self.session.imei,
            "initiatorMSISDN": self.session.msisdn,
            "language": self.session.language,
            "originatorConversationID": str(uuid.uuid4()),
            "platform": self.session.platform,
            "timestamp": str(int(time.time() * 1000)),
            "token": self.session.token,
            "version": self.session.version,
        }

    def fetch_balance(self) -> dict[str, Any]:
        return self._post_command("CustomerCombineQuery", self._balance_payload())

    def fetch_all_transactions(self, *, max_pages: int = 50) -> list[dict]:
        cursor = HistoryCursor()
        all_records: list[dict] = []
        seen: set[str] = set()
        for _ in range(max_pages):
            page = self.fetch_transaction_page(cursor=cursor)
            records = page.get("transRecordList") or []
            if not records:
                break
            for rec in records:
                oid = str(rec.get("orderId", ""))
                if oid and oid not in seen:
                    seen.add(oid)
                    all_records.append(rec)
            cursor.apply_page(records)
            if len(records) < PAGE_COUNT:
                break
        return all_records
