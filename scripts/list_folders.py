#!/usr/bin/env python3
"""
列出浏览器中所有收藏夹
"""

import json
import sys
import os

# 复用 migrate_bookmarks.py 中的路径定义
MACOS_BROWSER_PATHS = {
    "chrome": "~/Library/Application Support/Google/Chrome/Default/Bookmarks",
    "edge": "~/Library/Application Support/Microsoft Edge/Default/Bookmarks",
    "tabbit": "~/Library/Application Support/Tabbit/Default/Bookmarks",
    "arc": "~/Library/Application Support/Arc/User Data/Default/Bookmarks",
    "brave": "~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks",
}


def get_bookmarks_path(browser_name):
    browser_name = browser_name.lower()
    if browser_name not in MACOS_BROWSER_PATHS:
        print(f"❌ 不支持的浏览器: {browser_name}")
        print(f"支持的浏览器: {', '.join(MACOS_BROWSER_PATHS.keys())}")
        return None

    path = os.path.expanduser(MACOS_BROWSER_PATHS[browser_name])
    if not os.path.exists(path):
        print(f"❌ 书签文件不存在: {path}")
        print("请确认浏览器已安装并运行过至少一次")
        return None
    return path


def load_bookmarks(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def list_folders(node, path=""):
    """递归列出所有文件夹"""
    folders = []
    if node.get("type") == "folder":
        full_path = f"{path}/{node['name']}" if path else node["name"]
        bookmark_count = len([c for c in node.get("children", []) if c.get("type") == "url"])
        subfolder_count = len([c for c in node.get("children", []) if c.get("type") == "folder"])
        folders.append((full_path, bookmark_count, subfolder_count))
        for child in node.get("children", []):
            folders.extend(list_folders(child, full_path))
    return folders


def main():
    if len(sys.argv) < 2:
        print("用法: python3 list_folders.py <浏览器名称>")
        print("示例: python3 list_folders.py chrome")
        print(f"支持的浏览器: chrome, edge, tabbit, arc, brave")
        return

    browser = sys.argv[1]
    path = get_bookmarks_path(browser)
    if not path:
        return

    data = load_bookmarks(path)

    print(f"\n📂 {browser.upper()} 的所有收藏夹:\n")

    all_folders = []
    for root_name, root_node in data["roots"].items():
        if isinstance(root_node, dict):
            folders = list_folders(root_node)
            all_folders.extend(folders)

    if not all_folders:
        print("  (没有收藏夹)")
        return

    # 按层级排序显示
    for folder_path, bookmark_count, subfolder_count in sorted(all_folders):
        indent = "  " * (folder_path.count("/"))
        name = folder_path.split("/")[-1]
        info = f"{bookmark_count} 个书签"
        if subfolder_count > 0:
            info += f", {subfolder_count} 个子文件夹"
        print(f"{indent}📁 {name} ({info})")

    print(f"\n总计: {len(all_folders)} 个收藏夹")


if __name__ == "__main__":
    main()
