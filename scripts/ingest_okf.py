# -*- coding: utf-8 -*-
"""
name: ingest_okf
description: 把上传资料（docx/pdf/md/txt）转成 OKF concept 落盘到知识库，并重建 index.md + git commit。
params:
  - input: 输入文件路径（必填）
  - type: concept 类型（必填，如 FAQ/Document/Runbook）
  - title: 知识条目标题（必填）
  - tags: 逗号分隔标签（可选）
  - kb-dir: OKF bundle 根目录（默认 kb-okf）
timeout: 120
example: uv run scripts/ingest_okf.py --input report.docx --type Document --title 项目周报 --tags weekly,report
"""
import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path

# /// script
# requires-python = ">=3.10"
# dependencies = ["python-docx", "pypdf"]
# ///


def extract_text(input_path: Path) -> str:
    suffix = input_path.suffix.lower()
    if suffix == ".docx":
        from docx import Document
        doc = Document(str(input_path))
        parts = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        return "\n\n".join(parts)
    if suffix == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(input_path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix in (".md", ".txt", ".markdown"):
        return input_path.read_text(encoding="utf-8", errors="replace")
    raise SystemExit(f"error: unsupported file type {suffix} (docx/pdf/md/txt only)")


def split_sections(text: str, max_len: int = 1500, min_len: int = 8) -> list[str]:
    """按二级/三级标题切分；无标题按长度切。"""
    sections = re.split(r"\n(?=#{1,3}\s)", text)
    out: list[str] = []
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        while len(sec) > max_len:
            out.append(sec[:max_len])
            sec = sec[max_len:]
        out.append(sec)
    kept = [s for s in out if len(s.strip()) >= min_len]
    if not kept and text.strip():
        kept = [text.strip()]   # 兜底：整篇作为一节，绝不因太短而丢内容
    return kept


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", name).strip("-")
    return s[:60] or "concept"


def frontmatter(type_: str, title: str, tags: list[str]) -> str:
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tag_line = ", ".join(tags) if tags else ""
    return (
        "---\n"
        f"type: {type_}\n"
        f"title: {title}\n"
        f"description: {title}（ingest 自动导入）\n"
        f"tags: [{tag_line}]\n"
        f"timestamp: {now}\n"
        "---\n"
    )


def rebuild_index(kb: Path) -> None:
    lines = ["# 客服助手知识库", "", "> OKF Bundle：自动生成的目录导航。", ""]
    for md in sorted(kb.rglob("*.md")):
        if md.name in ("index.md", "log.md"):
            continue
        rel = md.relative_to(kb).as_posix()
        first = md.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"^title:\s*(.+)$", first, re.M)
        title = m.group(1).strip() if m else md.stem
        lines.append(f"* [{title}]({rel}) - 自动导入条目")
    (kb / "index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def git_commit(kb: Path, msg: str) -> None:
    r = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=kb, capture_output=True, text=True)
    if r.returncode != 0:
        subprocess.run(["git", "init", "-q"], cwd=kb, check=True)
    subprocess.run(["git", "add", "-A"], cwd=kb, check=True)
    subprocess.run(
        ["git", "-c", "user.name=wb-ingest", "-c", "user.email=ingest@local", "commit", "-qm", msg],
        cwd=kb, check=True, capture_output=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--type", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--tags", default="")
    ap.add_argument("--kb-dir", default=None)
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        raise SystemExit(f"error: input not found: {src}")

    kb = Path(args.kb_dir) if args.kb_dir else Path(__file__).resolve().parent.parent / "kb-okf"
    kb.mkdir(parents=True, exist_ok=True)

    text = extract_text(src)
    sections = split_sections(text)
    if not sections:
        raise SystemExit("error: no extractable content")

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    base = slugify(args.title)
    subdir = kb / "ingested"
    subdir.mkdir(exist_ok=True)

    written: list[Path] = []
    if len(sections) == 1:
        p = subdir / f"{base}.md"
        p.write_text(frontmatter(args.type, args.title, tags) + "\n" + sections[0] + "\n", encoding="utf-8")
        written.append(p)
    else:
        for i, sec in enumerate(sections, 1):
            head = sec.splitlines()[0].lstrip("# ").strip()[:40]
            p = subdir / f"{base}-{i:02d}-{slugify(head)}.md"
            p.write_text(frontmatter(args.type, f"{args.title} · {head}", tags) + "\n" + sec + "\n", encoding="utf-8")
            written.append(p)

    rebuild_index(kb)
    try:
        git_commit(kb, f"ingest: {args.title} ({len(written)} concepts)")
    except subprocess.CalledProcessError:
        print("warn: git commit skipped (nothing to commit?)", file=sys.stderr)

    print(f"ok: {len(written)} concepts -> {subdir}")


if __name__ == "__main__":
    main()
