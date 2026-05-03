"""analysis-engine の BT パッケージ (Critical-4 段階 1.8)

レイヤー:
- engine_protocol: BT エンジンの抽象インターフェイス (engine 非依存型)
- adapter:         ノート schema (リクエスト / レスポンス) ↔ engine 抽象 の変換
- runner:          司令塔。ノート schema を受けて adapter / engine を組み合わせる
- runner_<engine>: 各エンジン実装 (現状は backtesting.py)

外部 (main.py 等) は本パッケージから `run_screening_backtest` だけを参照する。
将来エンジン交換時に外部の import が変わらないよう、エンジン実装は __init__ から
re-export しない。
"""

from .runner import run_screening_backtest  # noqa: F401
