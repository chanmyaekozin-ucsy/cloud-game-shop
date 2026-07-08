"""Interactive SmileOne CLI menu."""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from providers.smileone.auth import SmileAuthError
from providers.smileone.client import SmileOneClient
from providers.smileone.config import load_env
from providers.smileone.mlbb import MlbbAccount
from providers.smileone.orders import parse_yyyy_mm_dd
from providers.smileone.packages import load_package_lists


def print_menu() -> None:
    print("Menu")
    print("--------")
    print("1. Check Balance")
    print("2. Order History")
    print("3. Mobile Legends Region Checker")
    print("4. MLBB Package List (Smile.one)")
    print("5. Own Package List (MMK)")
    print("0. Quit")
    print()


def run_balance(client: SmileOneClient) -> None:
    try:
        balance = client.get_balance()
    except SmileAuthError as e:
        print(f"Error: {e}", file=sys.stderr)
        return
    print(f"\nBalance: {balance}\n")


def run_order_history(client: SmileOneClient) -> None:
    print(
        "\nNote: Smile.one order times are UTC-3 (Brazil). "
        "Displayed below in Myanmar Time (MMT).\n"
    )
    try:
        start_raw = input("Start Date (yyyy-mm-dd) : ").strip()
        end_raw = input("End Date (yyyy-mm-dd) : ").strip()
    except EOFError:
        print()
        return

    start = parse_yyyy_mm_dd(start_raw)
    end = parse_yyyy_mm_dd(end_raw)
    if not start:
        print("Invalid start date. Use yyyy-mm-dd.", file=sys.stderr)
        return
    if not end:
        print("Invalid end date. Use yyyy-mm-dd.", file=sys.stderr)
        return

    page = 1
    while True:
        try:
            result = client.get_order_history(start, end, page=page)
        except SmileAuthError as e:
            print(f"Error: {e}", file=sys.stderr)
            return

        if not result.orders:
            print("\nNo orders in this date range.\n")
            return

        print()
        for i, row in enumerate(result.orders, start=1):
            print(f"{i}. Package Name : {row.package_name}")
            print(f"   Game : {row.game}")
            print(f"   Date :  {row.date_mmt}")
            print(f"   Price : {row.price}")
            print(f"   GameID : {row.game_id}")
            print(f"   ZoneID : {row.zone_id}")
            print()

        if result.total_pages <= 1:
            return

        print(f"Page {result.page} of {result.total_pages}")
        print("1. Next  2. Previous  3. Back")
        try:
            sub = input("Choose : ").strip()
        except EOFError:
            print()
            return
        if sub == "3":
            return
        if sub == "1" and page < result.total_pages:
            page += 1
            continue
        if sub == "2" and page > 1:
            page -= 1
            continue
        print("Invalid choice.\n")


def run_mlbb_region(client: SmileOneClient) -> None:
    try:
        gid = input("Game ID : ").strip()
        sid = input("Server ID (Zone ID) : ").strip()
    except EOFError:
        print()
        return
    if not gid or not sid:
        print("Game ID and Server ID are both required.", file=sys.stderr)
        return

    print()
    result = client.check_mlbb_account(gid, sid)
    if isinstance(result, str):
        print(f"❌ {result}", file=sys.stderr)
        return
    assert isinstance(result, MlbbAccount)
    print("✅ Account Found!")
    print(f"ID: {result.game_id}")
    print(f"Server: {result.server_id}")
    print(f"Nickname: {result.nickname}")
    print(f"Country: {result.country}")
    print(f"Region: {result.region}")
    print()


def run_mlbb_packages(client: SmileOneClient) -> None:
    try:
        packages = client.get_mlbb_packages()
    except SmileAuthError as e:
        print(f"Error: {e}", file=sys.stderr)
        return
    print("\nMLBB package list (Smile.one merchant)\n")
    for i, pkg in enumerate(packages, start=1):
        print(f"{i}. goods_id : {pkg.goods_id}")
        print(f"   Package Name : {pkg.name}")
        print(f"   BRL : {pkg.brl}")
        print(f"   Smile Coin : {pkg.smile_coin}")
        print()


def run_own_packages() -> None:
    records = load_package_lists()
    if not records:
        print("\nNo own packages yet. Edit .data/package_lists.json\n")
        return
    print("\nOwn package list (MMK)\n")
    for r in records:
        print(f"#{r.get('id')} — {r.get('package_name')}")
        print(f"   Price : {r.get('price')}")
        print(f"   Smile Coin : {r.get('smile_coin')}")
        print(f"   goods_id : {r.get('smile_goods_id')}")
        if r.get("note"):
            print(f"   Note : {r.get('note')}")
        print()


def main() -> int:
    load_env()
    client = SmileOneClient()
    print("Welcome to Cloud Game Shop — SmileOne\n")

    while True:
        print_menu()
        try:
            choice = input("Choose : ").strip()
        except EOFError:
            print("\nGoodbye.")
            return 0

        if choice == "0":
            print("Goodbye.")
            return 0
        if choice == "1":
            run_balance(client)
            continue
        if choice == "2":
            run_order_history(client)
            continue
        if choice == "3":
            run_mlbb_region(client)
            continue
        if choice == "4":
            run_mlbb_packages(client)
            continue
        if choice == "5":
            run_own_packages()
            continue
        print("Invalid choice. Enter 0–5.\n")


if __name__ == "__main__":
    raise SystemExit(main())
