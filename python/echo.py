"""
PythonBridge の round-trip 疎通確認用の最小スクリプト。

使い方（TS 側から docker exec で呼ばれる）:
    python /app/echo.py /app/shared/input-<id>.json /app/shared/output-<id>.json

input JSON をそのまま output JSON に書き戻す（タイムスタンプ追加）。
"""

import json
import sys
from datetime import datetime, timezone


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: echo.py <input.json> <output.json>", file=sys.stderr)
        return 2

    input_path = argv[1]
    output_path = argv[2]

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"failed to read input: {exc}", file=sys.stderr)
        return 1

    result = {
        "echoed": payload,
        "receivedAt": datetime.now(timezone.utc).isoformat(),
    }

    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
    except OSError as exc:
        print(f"failed to write output: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
