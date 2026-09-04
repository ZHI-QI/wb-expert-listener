# -*- coding: utf-8 -*-
"""
name: export_xlsx
description: 把 CSV 数据导出为 xlsx 表格文件（依赖 openpyxl，经 uv 自动安装）。
params:
  - csv_path: 输入 CSV 文件路径（必填）
  - out_path: 输出 xlsx 路径（必填）
timeout: 60
example: uv run scripts/export_xlsx.py --csv-path data.csv --out-path out.xlsx
"""
import argparse
import csv
import sys

# /// script
# requires-python = ">=3.10"
# dependencies = ["openpyxl"]
# ///
try:
    from openpyxl import Workbook
except ImportError:
    print("error: openpyxl not available — run with `uv run`", file=sys.stderr)
    raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv-path", required=True)
    ap.add_argument("--out-path", required=True)
    args = ap.parse_args()

    wb = Workbook()
    ws = wb.active
    with open(args.csv_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            ws.append(row)
    wb.save(args.out_path)
    print(f"saved: {args.out_path}")


if __name__ == "__main__":
    main()
