"""WavePay PIN/password RSA helpers (from PinEncryptManagerImpl)."""

from __future__ import annotations

import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(__file__).resolve().parent
DEFAULT_WM_PUBLIC = ROOT / "keys" / "wmpublic.pem"
DEFAULT_E2E_PUBLIC = ROOT / "keys" / "e2ePublicKey.pub"


def load_rsa_public_pem(path: Path | str | None = None):
    p = Path(path) if path else DEFAULT_WM_PUBLIC
    data = p.read_bytes()
    return serialization.load_pem_public_key(data)


def rsa_encrypt_pkcs1(plaintext: str, public_key=None) -> str:
    """RSA/ECB/PKCS1Padding + Base64 NO_WRAP (Android Base64 flag 2)."""
    key = public_key or load_rsa_public_pem()
    ct = key.encrypt(plaintext.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(ct).decode("ascii")


def encrypt_pin_token(pin: str, security_counter: str, public_key=None) -> str:
    """Encrypt `pin:securityCounter` for login password/pin fields."""
    return rsa_encrypt_pkcs1(f"{pin}:{security_counter}", public_key)


def load_e2e_public_pem(path: Path | str | None = None):
    p = Path(path) if path else DEFAULT_E2E_PUBLIC
    return serialization.load_pem_public_key(p.read_bytes())


def e2e_rsa_encrypt(aes_key_b64: str, iv_b64: str, public_key=None) -> str:
    """OWOD `key` header: RSA(aesKeyB64 + ':' + ivB64) with e2ePublicKey.pub."""
    key = public_key or load_e2e_public_pem()
    return rsa_encrypt_pkcs1(f"{aes_key_b64}:{iv_b64}", key)
