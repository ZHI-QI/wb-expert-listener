# -*- coding: utf-8 -*-
"""
name: db_query
description: 安全只读数据库查询。仅允许单条 SELECT 语句，禁止任何写操作；连接串从环境变量 DB_URL 读取。
params:
  - sql: 要执行的 SELECT 查询语句（必填）
  - limit: 最大返回行数，默认 100
timeout: 30
example: uv run python scripts/db_query.py --sql "SELECT COUNT(*) FROM orders"
"""
import argparse
import os
import re
import sys

try:
    import sqlite3
except ImportError:  # pragma: no cover
    sqlite3 = None

FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|replace|truncate|attach|pragma)\b",
    re.IGNORECASE,
)


def validate(sql: str) -> None:
    stripped = sql.strip().rstrip(";")
    if not stripped:
        raise SystemExit("error: sql is empty")
    if ";" in stripped:
        raise SystemExit("error: multiple statements not allowed")
    if not stripped.lower().startswith(("select", "with")):
        raise SystemExit("error: only SELECT/WITH queries are allowed")
    if FORBIDDEN.search(stripped):
        raise SystemExit("error: write/DDL keyword detected — read-only policy")


def main() -> None:
    ap = argparse.ArgumentParser(description="read-only SQL query")
    ap.add_argument("--sql", required=True, help="SELECT statement")
    ap.add_argument("--limit", type=int, default=100)
    args = ap.parse_args()

    validate(args.sql)

    db_url = os.environ.get("DB_URL")
    if not db_url:
        raise SystemExit("error: DB_URL env not set (sqlite file path or sqlite:/// URI)")

    path = db_url.replace("sqlite:///", "").replace("sqlite://", "")
    conn = sqlite3.connect(path)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(args.sql)
        rows = cur.fetchmany(args.limit)
        if not rows:
            print("[]")
            return
        cols = rows[0].keys()
        import json

        print(json.dumps([dict(zip(cols, r)) for r in rows], ensure_ascii=False, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
