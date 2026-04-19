#!/usr/bin/env python3
"""
WordPress エクスポート（WXR XML）から odoranyasonson-blog 静的サイトを生成する。

使い方:
  python3 scripts/build_odoranyasonson_site.py /path/to/export.xml

出力先（固定）:
  sites/odoranyasonson-blog/  （index.html, posts/, css は既存を維持し HTML のみ上書き生成）
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

NS = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "wp": "http://wordpress.org/export/1.2/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "excerpt": "http://wordpress.org/export/1.2/excerpt/",
}

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = REPO_ROOT / "sites" / "odoranyasonson-blog"
POSTS_DIR = SITE_DIR / "posts"


@dataclass
class Post:
    title: str
    slug: str
    date: str
    body_html: str
    link: str


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def _slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "post"


def strip_tags(fragment: str, max_len: int = 180) -> str:
    t = re.sub(r"<[^>]+>", "", fragment)
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > max_len:
        t = t[: max_len - 1] + "…"
    return t


def parse_posts(path: Path) -> list[Post]:
    tree = ET.parse(path)
    root = tree.getroot()
    channel = root.find("channel")
    if channel is None:
        raise SystemExit("XML に channel がありません（WordPress エクスポート形式か確認してください）")

    posts: list[Post] = []
    used_slugs: dict[str, int] = {}

    for item in channel.findall("item"):
        ptype = _text(item.find("wp:post_type", NS))
        status = _text(item.find("wp:status", NS))
        if ptype != "post" or status != "publish":
            continue

        title = _text(item.find("title")) or "無題"
        raw_slug = _text(item.find("wp:post_name", NS)) or _slugify(title)
        n = used_slugs.get(raw_slug, 0) + 1
        used_slugs[raw_slug] = n
        slug = raw_slug if n == 1 else f"{raw_slug}-{n}"

        date = _text(item.find("wp:post_date", NS)) or _text(item.find("pubDate")) or ""
        date_short = date[:10] if len(date) >= 10 else date

        enc = item.find("content:encoded", NS)
        body = enc.text if enc is not None and enc.text else ""

        link = _text(item.find("link")) or f"/posts/{slug}.html"

        posts.append(
            Post(
                title=title,
                slug=slug,
                date=date_short,
                body_html=body,
                link=link,
            )
        )

    posts.sort(key=lambda p: p.date, reverse=True)
    return posts


def layout_head(page_title: str, desc: str, *, asset_prefix: str, home_href: str) -> str:
    site = "踊る阿呆の踊らにゃソンソンblog"
    full_title = html.escape(f"{page_title} | {site}" if page_title else site)
    desc_e = html.escape(desc[:300])
    css_href = html.escape(f"{asset_prefix}css/theme.css")
    js_href = html.escape(f"{asset_prefix}js/theme.js")
    home_e = html.escape(home_href)
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="{desc_e}" />
  <title>{full_title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;600&family=Shippori+Mincho:wght@500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="{css_href}" />
</head>
<body>
  <a class="skip" href="#main">本文へスキップ</a>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="{home_e}">踊る阿呆の踊らにゃソンソンblog</a>
      <nav class="nav" aria-label="主要ナビ">
        <a href="{home_e}">記事一覧</a>
      </nav>
    </div>
  </header>
  <main id="main" class="wrap">
"""


def layout_foot(*, asset_prefix: str) -> str:
    js_href = html.escape(f"{asset_prefix}js/theme.js")
    return f"""
  </main>
  <footer class="site-footer">
    <p>© <span id="year"></span> 踊る阿呆の踊らにゃソンソンblog</p>
  </footer>
  <script src="{js_href}"></script>
</body>
</html>
"""


def write_index(posts: list[Post]) -> None:
    cards = []
    for p in posts:
        title_e = html.escape(p.title)
        desc = strip_tags(p.body_html)
        desc_e = html.escape(desc)
        cards.append(
            f"""<li class="post-card">
  <time class="post-card__date" datetime="{html.escape(p.date)}">{html.escape(p.date)}</time>
  <div>
    <h2 class="post-card__title"><a href="posts/{html.escape(p.slug)}.html">{title_e}</a></h2>
    <p style="margin:0.35rem 0 0;font-size:0.95rem;color:var(--text-muted)">{desc_e}</p>
  </div>
</li>"""
        )

    hero_desc = "現役 SE の視点から、資格・試験・仕事のモヤモヤを文章にしています。（静的サイト・新デザイン）"
    inner = f"""<section class="hero">
  <span class="hero__label">Blog</span>
  <h1>考えを、少しずつ言語化する。</h1>
  <p>{html.escape(hero_desc)}</p>
</section>
<ul class="post-list">
{chr(10).join(cards)}
</ul>"""

    html_out = layout_head("", hero_desc, asset_prefix="", home_href="index.html") + inner + layout_foot(asset_prefix="")
    (SITE_DIR / "index.html").write_text(html_out, encoding="utf-8")


def write_post(p: Post) -> None:
    title_e = html.escape(p.title)
    meta = html.escape(p.date)
    body = p.body_html or "<p>（本文なし）</p>"
    inner = f"""<a class="back" href="../index.html">← 記事一覧</a>
<article class="article">
  <p class="article__meta"><time datetime="{html.escape(p.date)}">{meta}</time></p>
  <h1>{title_e}</h1>
  <div class="post-body">
  {body}
  </div>
</article>"""
    desc = strip_tags(p.body_html)
    page = layout_head(p.title, desc, asset_prefix="../", home_href="../index.html") + inner + layout_foot(asset_prefix="../")
    out = POSTS_DIR / f"{p.slug}.html"
    out.write_text(page, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="WordPress WXR から静的ブログを生成")
    parser.add_argument("wxr", type=Path, help="WordPress エクスポート XML のパス")
    args = parser.parse_args()
    wxr: Path = args.wxr.expanduser().resolve()
    if not wxr.is_file():
        print(f"ファイルが見つかりません: {wxr}", file=sys.stderr)
        sys.exit(1)

    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    posts = parse_posts(wxr)
    if not posts:
        print("公開済みの投稿（post / publish）が 0 件でした。XML の中身を確認してください。", file=sys.stderr)
        sys.exit(2)

    write_index(posts)
    for p in posts:
        write_post(p)

    print(f"生成完了: {len(posts)} 件")
    print(f"出力: {SITE_DIR}")
    print("次: sites/odoranyasonson-blog/README.md の手順で Cloudflare Pages にデプロイしてください。")


if __name__ == "__main__":
    main()
