#!/usr/bin/env python3
"""
Auto-generate README.md from each extension's manifest.json + DESCRIPTION.md.

Rules:
- Extension = any subdirectory in repo root that contains manifest.json
- DESCRIPTION.md (optional) provides detailed Chinese content for the README
- Falls back to manifest["description"] if no DESCRIPTION.md

Add a new extension? Just create its folder with manifest.json.
The next push to main will auto-detect it and update README + Releases.
"""

import json
import os
import sys

REPO = "stantheman0128/stan-chrome-extensions"
BASE_DOWNLOAD_URL = f"https://github.com/{REPO}/releases/latest/download"

BADGE_COLORS = ["blue", "red", "green", "orange", "9B59B6"]

EXCLUDED = {".github", "node_modules", ".git"}


def find_extensions(root="."):
    extensions = []
    for name in sorted(os.listdir(root)):
        if name in EXCLUDED or name.startswith("."):
            continue
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        manifest_path = os.path.join(path, "manifest.json")
        if not os.path.exists(manifest_path):
            continue
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
        extensions.append({"dir": name, "manifest": manifest})
    return extensions


def get_description_md(ext_dir):
    path = os.path.join(ext_dir, "DESCRIPTION.md")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    return None


def make_badge(dir_name, color):
    # shields.io requires hyphens doubled to render as literal hyphens
    badge_label = dir_name.replace("-", "--")
    download_url = f"{BASE_DOWNLOAD_URL}/{dir_name}.zip"
    badge_img = (
        f"https://img.shields.io/badge/下載-{badge_label}.zip-{color}"
        f"?style=for-the-badge&logo=googlechrome"
    )
    return f"[![下載 {dir_name}]({badge_img})]({download_url})"


def list_files(ext_dir):
    return sorted(
        f for f in os.listdir(ext_dir)
        if not f.startswith(".") and os.path.isfile(os.path.join(ext_dir, f))
    )


def generate_readme(extensions):
    lines = [
        "# Stan Chrome Extensions",
        "",
        "基於 Manifest V3 打造的輕量級 Chrome 擴充功能合集。",
        "",
        "> **README 由 GitHub Actions 自動生成。**",
        "> 欲修改擴充功能的說明，請編輯對應資料夾內的 `DESCRIPTION.md`。",
        "",
        "---",
        "",
        "## 擴充功能列表",
        "",
    ]

    for i, ext in enumerate(extensions):
        manifest = ext["manifest"]
        dir_name = ext["dir"]
        ext_name = manifest.get("name", dir_name)
        color = BADGE_COLORS[i % len(BADGE_COLORS)]

        lines.append(f"### {i + 1}. {ext_name}")
        lines.append("")
        lines.append(f"**資料夾：** `{dir_name}/`")
        lines.append("")

        # Detailed description: DESCRIPTION.md > manifest.description
        detail = get_description_md(dir_name) or manifest.get("description", "")
        if detail:
            lines.append(detail)
            lines.append("")

        lines.append("**一鍵下載**")
        lines.append("")
        lines.append(make_badge(dir_name, color))
        lines.append("")

        lines += [
            "**安裝方式**",
            "1. 點上方按鈕下載 `.zip` 並解壓縮",
            "2. 開啟 Chrome，前往 `chrome://extensions`",
            "3. 啟用右上角的**開發人員模式**",
            f"4. 點擊**載入未封裝項目**，選擇解壓縮後的 `{dir_name}` 資料夾",
            "",
            "---",
            "",
        ]

    # Project structure (auto-generated from actual files)
    lines += ["## 專案結構", "", "```", "stan-chrome-extensions/"]
    for j, ext in enumerate(extensions):
        dir_name = ext["dir"]
        files = list_files(dir_name)
        is_last_ext = j == len(extensions) - 1
        ext_prefix = "└──" if is_last_ext else "├──"
        lines.append(f"{ext_prefix} {dir_name}/")
        for k, f in enumerate(files):
            is_last_file = k == len(files) - 1
            indent = "    " if is_last_ext else "│   "
            file_prefix = "└──" if is_last_file else "├──"
            lines.append(f"{indent}{file_prefix} {f}")
    lines += [
        "```",
        "",
        "## 新增擴充功能",
        "",
        "在 repo 根目錄建立新子目錄並放入 `manifest.json`，",
        "下次推送到 main 時 GitHub Actions 將自動打包、更新 Release 並重新生成此 README。",
        "",
        "## 授權條款",
        "",
        "MIT",
        "",
    ]

    return "\n".join(lines)


if __name__ == "__main__":
    # Always run from repo root
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    os.chdir(repo_root)

    extensions = find_extensions()
    if not extensions:
        print("No extensions found!", file=sys.stderr)
        sys.exit(1)

    readme = generate_readme(extensions)
    with open("README.md", "w", encoding="utf-8") as f:
        f.write(readme)

    names = [e["dir"] for e in extensions]
    print(f"Generated README.md — {len(extensions)} extension(s): {names}")
