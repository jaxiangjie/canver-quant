# -*- coding: utf-8 -*-
"""回补指数 PE 历史（乐咕乐股 via AKShare）→ data/valuation/index_pe_history.jsonl
运行：系统 Python（需已装 akshare）。用法：python scripts/backfill_index_pe.py
"""
import akshare as ak
import json
import os
import sys

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'data', 'valuation', 'index_pe_history.jsonl'))
# (akshare symbol, 指数6位代码)；口径=滚动市盈率(PE-TTM)，与腾讯快照 parts[39] 同口径
INDEXES = [
    ('沪深300', '000300'),
    ('中证500', '000905'),
    ('科创50', '000688'),
]

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    total = 0
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        for name, code in INDEXES:
            try:
                df = ak.stock_index_pe_lg(symbol=name)
            except Exception as e:
                print(f'[FAIL] {name} PE: {e}', file=sys.stderr)
                continue
            cols = list(df.columns)
            # 乐咕列名为中文：日期/滚动市盈率（TTM，与腾讯快照 parts[39] 同口径）
            date_col = next((c for c in cols if '日期' in str(c)), None)
            pe_col = next((c for c in cols if '滚动' in str(c) and '等权' not in str(c) and '中位' not in str(c)), None)
            if pe_col is None or date_col is None:
                print(f'[WARN] {name} 未找到滚动PE列，实际列={cols}', file=sys.stderr)
                continue
            # PB 历史（同源月频）：与 PE 按日期合并成一条记录（估值分位需 pe+pb 双分位）
            pb_by_date = {}
            try:
                df_pb = ak.stock_index_pb_lg(symbol=name)
                pb_cols = list(df_pb.columns)
                pb_date_col = next((c for c in pb_cols if '日期' in str(c)), None)
                pb_col = next((c for c in pb_cols if str(c) == '市净率'), None)
                if pb_date_col and pb_col:
                    for _, row in df_pb.iterrows():
                        try:
                            v = float(row[pb_col])
                            if v > 0:
                                pb_by_date[str(row[pb_date_col])[:10]] = round(v, 3)
                        except (TypeError, ValueError):
                            continue
            except Exception as e:
                print(f'[WARN] {name} PB 回补失败（仅 PE）: {e}', file=sys.stderr)
            n = 0
            for _, row in df.iterrows():
                d = str(row[date_col])[:10]
                try:
                    pe = float(row[pe_col])
                except (TypeError, ValueError):
                    continue
                if pe <= 0:
                    continue
                rec = {'date': d, 'key': code, 'pe': round(pe, 2), 'source': 'legulegu'}
                if d in pb_by_date:
                    rec['pb'] = pb_by_date[d]
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
                n += 1
            print(f'[OK] {name}({code}): {n} rows, {cols}')
            total += n
    print(f'DONE total={total} -> {OUT}')

if __name__ == '__main__':
    main()
