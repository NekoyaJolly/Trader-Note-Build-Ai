"""
ヘルスチェック用スクリプト。

PythonBridge.healthCheck() および docker-compose の healthcheck から呼ばれる。
exit code 0 で「コンテナが生きている」と判定する。
"""

import sys


def main() -> int:
    # ここでは「import が通る」「stdout が出せる」だけ確認する。
    # 将来ライブラリ追加時に、重要モジュールの import も追加してよい。
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
