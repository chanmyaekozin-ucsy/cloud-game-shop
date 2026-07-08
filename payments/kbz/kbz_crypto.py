"""
KBZ Pay v5.8.5 request/response crypto (from APK decompile).

Sources (apk/jadx_out):
  com.huawei.kbz.utils.encrypt.AESUtil
  com.huawei.kbz.net.retrofit.EncryptInterceptor
  com.huawei.kbz.utils.encrypt.HMacSha256Util
  com.huawei.kbz.net.retrofit.RetrofitService.postNew @Headers MessageType:NEW

Per request:
  key_b64 = Base64(32 random bytes)           # AESUtil.genarateRandomKey()
  iv_hex    = hex(32 random bytes)            # EncryptUtilSecurity.generateSecureRandomStr(32)
  Authorization = RSA-OAEP(key_b64)
  IvKey         = RSA-OAEP(iv_hex)
  Sign          = HMAC-SHA256(key=key_b64 UTF-8, msg=timestamp+iv_hex+plaintext)
  body          = Base64(AES-GCM(plaintext))  # nonce = iv_hex as UTF-8 (64 bytes)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from typing import Any

from Crypto.Cipher import AES
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

# assets/url_config/comm_const.json → release.SERVER_PUBLIC_KEY (KBZ Pay v5.8.5 APK)
SERVER_PUBLIC_KEY_B64 = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0UQfZRSV8UYTsK+LhuiFpvjrxaX6m726PKMD"
    "Wjm6OXmy4Wv+0wr6VBSus5dVxgGrF4dnFuCID8TZ8mqfQS0w4/HqY6iUk5WSLVCrH7znsu5YKXoFd9m3eFIcS"
    "zyJZ2Bfz3/sTpjNyYIJeO+f7KkZoMarq5lTB6/38VfMGstI4YGEokH6t9UX5tDcz/kWRFRkUT3Xztqb6uO9okQ"
    "qH7g8Ft0UOuhFj7WIL9uHNbToIP4bBVgBLCp5Nki8EclmCm3hI8s/k4yYi8OLwGo9AQB65Jrniq1uClZxkTyxs"
    "fcHGLSMp1hpy9I6JEpKQL3XqJso7OgHzkb0mkq2eZOA0nGnTQIDAQAB"
)

# assets/url_config/comm_const.json → release.MM_PUBLIC_KEY (PIN encryption, RSA PKCS#1 v1.5)
MM_PUBLIC_KEY_B64 = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt/6qX9qc24RSBab/2t9K8g2UXhxznT7OMH22WNENWULL4NO8zJtjk2dwekNgNGb57az62x3RPiPn1ontVp6rwkAEBKdYcJfo3uEV1UVM/0OOJ3uqZJykXFIQlDGiPrBJShXeP2MYWRY6unE15BtXdRA+Iq1GEuBYkaMjR5OD+KjgNtTXXkzhJNEyChJ+0my9hwGqm2bLvnDTMeoqRej/6UOr5kDDyuY1MzDZiQCB3I6IAM30ycU65NGbWTgJSkRllzNR0+3bXYRK1PCKwceC+fZJnSIuF2zRP4rU8/k6i0wOJRpy+lloHNgTUO1tLRKElg0pCAb7aeIZIDzmfVEgYQIDAQAB"
)

GCM_TAG_LEN = 16


@dataclass(frozen=True)
class EncryptedRequest:
    headers: dict[str, str]
    body: str
    key_b64: str
    iv_hex: str
    timestamp_ms: int
    plaintext_json: str = ""

    @property
    def key_hex(self) -> str:
        return base64.b64decode(self.key_b64).hex()


def generate_aes_key_b64() -> str:
    """AESUtil.genarateRandomKey() -> Base64Util.encode(32 random bytes)."""
    return base64.b64encode(secrets.token_bytes(32)).decode("ascii")


def generate_iv_hex() -> str:
    """EncryptUtilSecurity.generateSecureRandomStr(32) -> lowercase hex of 32 bytes."""
    return secrets.token_hex(32)


def build_vague_pin(pin: str, timestamp_ms: str, conversation_id: str) -> str:
    """CommonUtil.getVaguePin — random prefix/suffix around PIN + timestamp + UUID."""
    prefix = secrets.randbelow(10000)
    suffix = secrets.randbelow(100)
    return f"01{prefix:04d}06{timestamp_ms}{pin}{conversation_id}{suffix:02d}"


def rsa_encrypt_pin(plaintext: str, public_key_b64: str = MM_PUBLIC_KEY_B64) -> str:
    """RSAUtil.encryptPIN — RSA/ECB/PKCS1Padding (not OAEP)."""
    der = base64.b64decode(public_key_b64)
    pub = serialization.load_der_public_key(der)
    ct = pub.encrypt(
        plaintext.encode("utf-8"),
        padding.PKCS1v15(),
    )
    return base64.b64encode(ct).decode("ascii")


def encrypt_pin(pin: str, timestamp_ms: str, conversation_id: str) -> str:
    """PinEncryption.encryption(pin, timestamp, originatorConversationID)."""
    vague = build_vague_pin(pin, timestamp_ms, conversation_id)
    return rsa_encrypt_pin(vague)


def rsa_encrypt(plaintext: str, public_key_b64: str = SERVER_PUBLIC_KEY_B64) -> str:
    der = base64.b64decode(public_key_b64)
    pub = serialization.load_der_public_key(der)
    ct = pub.encrypt(
        plaintext.encode("utf-8"),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA1()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ct).decode("ascii")


def gcm_nonce_from_iv_hex(iv_hex: str) -> bytes:
    """AESUtil: IvParameterSpec(iv_hex.getBytes()) — full 64-char hex string as GCM nonce."""
    return iv_hex.encode("utf-8")


def _aes_gcm_encrypt(plaintext: bytes, key: bytes, nonce: bytes) -> bytes:
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ct, tag = cipher.encrypt_and_digest(plaintext)
    return ct + tag


def _aes_gcm_decrypt(ciphertext_tag: bytes, key: bytes, nonce: bytes) -> bytes:
    if len(ciphertext_tag) < GCM_TAG_LEN:
        raise ValueError("ciphertext too short for GCM tag")
    ct, tag = ciphertext_tag[:-GCM_TAG_LEN], ciphertext_tag[-GCM_TAG_LEN:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    return cipher.decrypt_and_verify(ct, tag)


def sign_request(timestamp_ms: int, iv_hex: str, plaintext_json: str, key_b64: str) -> str:
    """HMacSha256Util.hashMacSha256(timestamp + iv + plain, aesKey)."""
    msg = f"{int(timestamp_ms)}{iv_hex}{plaintext_json}"
    return hmac.new(key_b64.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


def aes_encrypt_body(plaintext: str, key_b64: str, iv_hex: str) -> str:
    key = base64.b64decode(key_b64)
    nonce = gcm_nonce_from_iv_hex(iv_hex)
    ct_tag = _aes_gcm_encrypt(plaintext.encode("utf-8"), key, nonce)
    return base64.b64encode(ct_tag).decode("ascii")


def aes_decrypt_body(ciphertext_b64: str, key_b64: str, iv_hex: str) -> str:
    key = base64.b64decode(key_b64)
    nonce = gcm_nonce_from_iv_hex(iv_hex)
    raw = base64.b64decode(ciphertext_b64.strip())
    return _aes_gcm_decrypt(raw, key, nonce).decode("utf-8")


def build_request_headers(
    *,
    timestamp_ms: int,
    key_b64: str,
    iv_hex: str,
    plaintext_json: str,
    command_id: str,
    version: str = "5.8.5",
    public_key_b64: str = SERVER_PUBLIC_KEY_B64,
    message_type_new: bool = True,
) -> dict[str, str]:
    """Legacy protocol v1 (AirtimeTopUp, ScanQRCode2) must not send MessageType: NEW."""
    ts = int(timestamp_ms)
    headers: dict[str, str] = {
        "Authorization": rsa_encrypt(key_b64, public_key_b64),
        "IvKey": rsa_encrypt(iv_hex, public_key_b64),
        "Sign": sign_request(ts, iv_hex, plaintext_json, key_b64),
        "Timestamp": str(ts),
        "Content-Type": "application/json; charset=utf-8",
        "KBZPay-Command-Id": command_id,
        "KBZPay-App-Type": "customer",
        "KBZPay-Device-Type": "Android",
        "KBZPay-Version": version,
    }
    if message_type_new:
        headers["MessageType"] = "NEW"
    return headers


def build_encrypted_request(
    plaintext_json: str,
    *,
    command_id: str = "NewTransRecordList",
    timestamp_ms: int | None = None,
    key_b64: str | None = None,
    iv_hex: str | None = None,
    version: str = "5.8.5",
    public_key_b64: str = SERVER_PUBLIC_KEY_B64,
    message_type_new: bool = True,
) -> EncryptedRequest:
    key_b64 = key_b64 or generate_aes_key_b64()
    iv_hex = iv_hex or generate_iv_hex()
    ts = int(time.time() * 1000) if timestamp_ms is None else int(timestamp_ms)
    headers = build_request_headers(
        timestamp_ms=ts,
        key_b64=key_b64,
        iv_hex=iv_hex,
        plaintext_json=plaintext_json,
        command_id=command_id,
        version=version,
        public_key_b64=public_key_b64,
        message_type_new=message_type_new,
    )
    body = aes_encrypt_body(plaintext_json, key_b64, iv_hex)
    return EncryptedRequest(
        headers=headers,
        body=body,
        key_b64=key_b64,
        iv_hex=iv_hex,
        timestamp_ms=ts,
        plaintext_json=plaintext_json,
    )


def decrypt_response_body(
    body: str,
    key_b64: str,
    iv_hex: str,
    *,
    is_encrypt: str | None = None,
) -> str:
    if is_encrypt is not None and is_encrypt.lower() not in ("true", "1", "yes"):
        return body
    return aes_decrypt_body(body.strip(), key_b64, iv_hex)


# Backward-compatible aliases (older code used key_hex)
def aes_key_b64_to_hex(key_b64: str) -> str:
    return base64.b64decode(key_b64).hex()


def aes_key_hex_to_b64(key_hex: str) -> str:
    return base64.b64encode(bytes.fromhex(key_hex)).decode("ascii")


def key_material_to_bytes(material: str) -> bytes:
    material = material.strip()
    if len(material) == 64 and all(c in "0123456789abcdefABCDEF" for c in material):
        return bytes.fromhex(material)
    return base64.b64decode(material)
