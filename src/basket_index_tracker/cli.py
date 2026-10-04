from __future__ import annotations

import argparse
import json

from basket_index_tracker.market_cap import refresh_market_caps


def main() -> None:
    parser = argparse.ArgumentParser(prog="basket-index-tracker")
    subcommands = parser.add_subparsers(dest="command", required=True)
    refresh = subcommands.add_parser("refresh-market-caps", help="Enrich shared daily prices with historical shares and market caps.")
    refresh.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if args.command == "refresh-market-caps":
        result = refresh_market_caps(workers=args.workers)
        print(json.dumps(result, indent=2, sort_keys=True))
        if result["errors"]:
            raise SystemExit(1)
