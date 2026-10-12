# -*- coding: utf-8 -*-
"""回补个股估值历史（百度股市通 via AKShare）→ data/valuation/stock_valuation_history.jsonl
周频 PE-TTM / PB，从上市起全历史。运行：系统 Python（已装 akshare）。
用法：python scripts/backfill_stock_valuation.py
"""
import akshare as ak
import json
import os
import sys
import time

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'data', 'valuation', 'stock_valuation_history.jsonl'))
# catalog 全部个股（stock_cn，含两池共用的 601857）
STOCKS = [
    '601288', '601318', '600886', '601088', '601919',
    '601899', '601857', '000333', '600660', '002714', '002223',
]

def fetch(sym: str, indicator: str) -> dict:
    df = ak.stock_zh_valuation_baidu(symbol=sym, indicator=indicator, period='全部')
    out = {}
    for _, row in df.iterrows():
        d = str(row['date'])[:10]
        try:
            v = float(row['value'])
        except (TypeError, ValueError):
            continue
        if v > 0:
            out[d] = round(v, 3)
    return out

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    total = 0
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        for sym in STOCKS:
            try:
                pe = fetch(sym, '市盈率(TTM)')
                time.sleep(0.5)
                pb = fetch(sym, '市净率')
                time.sleep(0.5)
            except Exception as e:
                print(f'[FAIL] {sym}: {e}', file=sys.stderr)
                continue
            dates = sorted(set(pe) | set(pb))
            n = 0
            for d in dates:
                rec = {'date': d, 'key': sym, 'source': 'baidu'}
                if d in pe:
                    rec['pe'] = pe[d]
                if d in pb:
                    rec['pb'] = pb[d]
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
                n += 1
            span = f'{dates[0]}→{dates[-1]}' if dates else 'empty'
            print(f'[OK] {sym}: {n} rows ({span}, pe={len(pe)} pb={len(pb)})')
            total += n
    print(f'DONE total={total} -> {OUT}')

if __name__ == '__main__':
    main()
