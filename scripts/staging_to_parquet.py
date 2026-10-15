# -*- coding: utf-8 -*-
"""staging bars JSON → 统一池 parquet（schema 与 data/parquet/daily 底座完全一致）。

用法: python staging_to_parquet.py <bars_json> <out_parquet> <bare_code>
schema（对照 510300_hfq.parquet）: date timestamp[ms], open/high/low/close/volume/amount double, code string

退出码: 0=成功; 2=空 bars; 3=输入数据坏（缺字段/日期不可解析）; 4=自校验失败（写出的 parquet 与期望不符）。
date 口径（2026-10-14 修正，tribunal V1）：底座 parquet 的 date 是 **UTC 午夜** epoch-ms
（底座 510300 的 2013-01-04 = 1357257600000），不是东八区午夜（1357228800000，早 8 小时）。
此前写东八区导致晋升标的整条日线早一天且无任何报错。写完必须读回自校验。
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq

EXIT_EMPTY = 2
EXIT_BAD_INPUT = 3
EXIT_VERIFY_FAILED = 4


def _parse_utc_midnight_ms(trade_date: str) -> int:
    """'YYYY-MM-DD' → UTC 当日 00:00 的 epoch-ms（与底座 parquet date 列语义一致）。"""
    return int(datetime.strptime(trade_date, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)


def main():
    if len(sys.argv) != 4:
        print("usage: staging_to_parquet.py <bars_json> <out_parquet> <bare_code>", file=sys.stderr)
        sys.exit(EXIT_BAD_INPUT)
    bars_path, out_path, code = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        with open(bars_path, "r", encoding="utf-8") as f:
            bars = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        print(f"bad input: bars json unreadable: {e}", file=sys.stderr)
        sys.exit(EXIT_BAD_INPUT)
    if not isinstance(bars, list) or not bars:
        print("empty bars", file=sys.stderr)
        sys.exit(EXIT_EMPTY)

    # 逐条校验字段与日期可解析性——坏数据必须在这里炸响，而不是写进池里
    dates = []
    for i, b in enumerate(bars):
        try:
            d = _parse_utc_midnight_ms(b["tradeDate"])
            float(b["open"]), float(b["high"]), float(b["low"]), float(b["close"])
            float(b["volume"]), float(b["amount"])
        except (KeyError, ValueError, TypeError) as e:
            print(f"bad input: bar[{i}] field error: {e}", file=sys.stderr)
            sys.exit(EXIT_BAD_INPUT)
        dates.append(d)

    table = pa.table(
        {
            "date": pa.array(dates, pa.timestamp("ms")),
            "open": pa.array([float(b["open"]) for b in bars], pa.float64()),
            "high": pa.array([float(b["high"]) for b in bars], pa.float64()),
            "low": pa.array([float(b["low"]) for b in bars], pa.float64()),
            "close": pa.array([float(b["close"]) for b in bars], pa.float64()),
            "volume": pa.array([float(b["volume"]) for b in bars], pa.float64()),
            "amount": pa.array([float(b["amount"]) for b in bars], pa.float64()),
            "code": pa.array([code] * len(bars), pa.string()),
        }
    )

    # 唯一 tmp 名（同目录保证 os.replace 原子性），失败路径清理，绝不留残骸
    out_dir = os.path.dirname(os.path.abspath(out_path))
    fd, tmp = tempfile.mkstemp(dir=out_dir, prefix=".staging_", suffix=".parquet")
    os.close(fd)
    try:
        pq.write_table(table, tmp)
        # 自校验：读回刚落盘的文件，逐项核对 date 原始值与 schema
        back = pq.read_table(tmp)
        if back.num_rows != len(bars) or back.column_names != table.column_names:
            raise RuntimeError(f"self-verify: rows/columns mismatch ({back.num_rows} vs {len(bars)})")
        raw_dates = back.column("date").to_pylist()  # datetime 对象（UTC）
        for i, dt in enumerate(raw_dates):
            expect_ms = dates[i]
            got_ms = int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000) if dt.tzinfo is None else int(dt.timestamp() * 1000)
            if got_ms != expect_ms:
                raise RuntimeError(
                    f"self-verify: date[{i}] expected {expect_ms} got {got_ms} "
                    f"(tradeDate={bars[i]['tradeDate']})"
                )
        os.replace(tmp, out_path)
    except Exception as e:
        if os.path.exists(tmp):
            os.unlink(tmp)
        print(f"self-verify failed: {e}", file=sys.stderr)
        sys.exit(EXIT_VERIFY_FAILED)
    print(f"OK {code}: {len(bars)} bars -> {out_path} (date basis: UTC midnight, self-verified)")


if __name__ == "__main__":
    main()
