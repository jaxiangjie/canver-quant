# -*- coding: utf-8 -*-
"""staging bars JSON → 统一池 parquet（schema 与 data/parquet/daily 底座完全一致）。

用法: python staging_to_parquet.py <bars_json> <out_parquet> <bare_code>
schema（对照 510300_hfq.parquet）: date timestamp[ms], open/high/low/close/volume/amount double, code string
"""
import json
import sys
from datetime import datetime, timezone, timedelta

import pyarrow as pa
import pyarrow.parquet as pq


def main():
    bars_path, out_path, code = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(bars_path, "r", encoding="utf-8") as f:
        bars = json.load(f)
    if not bars:
        print("empty bars", file=sys.stderr)
        sys.exit(2)

    # JSON 里是 ISO 字符串 → timestamp[ms]（东八区当日 00:00，与底座 Date 语义对齐）
    tz8 = timezone(timedelta(hours=8))
    dates = [int(datetime.strptime(b["tradeDate"], "%Y-%m-%d").replace(tzinfo=tz8).timestamp() * 1000) for b in bars]

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
    tmp = out_path + ".tmp.parquet"
    pq.write_table(table, tmp)
    import os

    os.replace(tmp, out_path)
    print(f"OK {code}: {len(bars)} bars -> {out_path}")


if __name__ == "__main__":
    main()
