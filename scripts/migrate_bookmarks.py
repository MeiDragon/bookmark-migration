#!/usr/bin/env python3
"""
浏览器收藏夹迁移脚本
支持 Chrome、Edge、Firefox、Safari、Tabbit、Arc、Brave 等主流浏览器
"""

import json
import shutil
import time
import uuid
import hashlib
import copy
import sqlite3
import plistlib
import argparse
import sys
import os
from pathlib import Path

# macOS 浏览器书签路径
MACOS_BROWSER_PATHS = {
    "chrome": "~/Library/Application Support/Google/Chrome/Default/Bookmarks",
    "edge": "~/Library/Application Support/Microsoft Edge/Default/Bookmarks",
    "firefox": "~/Library/Application Support/Firefox/Profiles",
    "safari": "~/Library/Safari/Bookmarks.plist",
    "tabbit": "~/Library/Application Support/Tabbit/Default/Bookmarks",
    "arc": "~/Library/Application Support/Arc/User Data/Default/Bookmarks",
    "brave": "~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks",
}

# Windows 浏览器书签路径
WINDOWS_BROWSER_PATHS = {
    "chrome": "%LOCALAPPDATA%/Google/Chrome/User Data/Default/Bookmarks",
    "edge": "%LOCALAPPDATA%/Microsoft/Edge/User Data/Default/Bookmarks",
    "firefox": "%APPDATA%/Mozilla/Firefox/Profiles",
    "brave": "%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/Default/Bookmarks",
}


def get_bookmarks_path(browser_name, platform=None):
    """获取浏览器书签文件路径"""
    if platform is None:
        platform = sys.platform

    browser_name = browser_name.lower()

    if platform == "darwin":
        paths = MACOS_BROWSER_PATHS
    elif platform.startswith("win"):
        paths = WINDOWS_BROWSER_PATHS
    else:
        raise ValueError(f"Unsupported platform: {platform}")

    if browser_name not in paths:
        raise ValueError(f"Unsupported browser: {browser_name}")

    path = os.path.expanduser(paths[browser_name])

    # Firefox 需要找到 profiles 目录下的 places.sqlite
    if browser_name == "firefox":
        profile_dir = find_firefox_profile(path)
        if profile_dir:
            return os.path.join(profile_dir, "places.sqlite")
        return None

    # Safari 使用 plist
    if browser_name == "safari":
        return path if os.path.exists(path) else None

    return path if os.path.exists(os.path.expanduser(path)) else None


def find_firefox_profile(base_path):
    """查找 Firefox 默认 profile 目录"""
    base_path = os.path.expanduser(base_path)
    if not os.path.exists(base_path):
        return None
    for item in os.listdir(base_path):
        if item.endswith(".default") or item.endswith(".default-release"):
            full_path = os.path.join(base_path, item)
            if os.path.isdir(full_path):
                return full_path
    return None


def load_chromium_bookmarks(path):
    """加载 Chromium 系浏览器书签（JSON格式）"""
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_firefox_bookmarks(path):
    """加载 Firefox 书签（SQLite格式）"""
    conn = sqlite3.connect(path)
    cursor = conn.cursor()

    # 获取所有书签
    cursor.execute("""
        SELECT b.id, b.title, b.parent, b.position, p.url
        FROM moz_bookmarks b
        LEFT JOIN moz_places p ON b.fk = p.id
        WHERE b.type = 1
        ORDER BY b.parent, b.position
    """)

    bookmarks = []
    for row in cursor.fetchall():
        bookmarks.append({
            "id": row[0],
            "name": row[1],
            "parent": row[2],
            "position": row[3],
            "url": row[4]
        })

    # 获取文件夹结构
    cursor.execute("""
        SELECT id, title, parent, position
        FROM moz_bookmarks
        WHERE type = 2
        ORDER BY parent, position
    """)

    folders = {}
    for row in cursor.fetchall():
        folders[row[0]] = {
            "id": row[0],
            "name": row[1],
            "parent": row[2],
            "position": row[3],
            "children": []
        }

    conn.close()
    return {"bookmarks": bookmarks, "folders": folders}


def load_safari_bookmarks(path):
    """加载 Safari 书签（plist格式）"""
    with open(path, 'rb') as f:
        plist = plistlib.load(f)
    return plist


def find_folder(node, name):
    """递归查找指定名称的文件夹"""
    if node.get("type") == "folder" and node.get("name") == name:
        return node
    for child in node.get("children", []):
        result = find_folder(child, name)
        if result:
            return result
    return None


def find_bookmarks_by_keyword(node, keyword):
    """按关键词查找书签"""
    results = []
    keyword_lower = keyword.lower()

    def search(node):
        if node.get("type") == "url":
            name = node.get("name", "").lower()
            url = node.get("url", "").lower()
            if keyword_lower in name or keyword_lower in url:
                results.append(node)
        for child in node.get("children", []):
            search(child)

    search(node)
    return results


def get_max_id(node):
    """获取书签树中的最大ID"""
    max_id = int(node.get("id", 0))
    for child in node.get("children", []):
        max_id = max(max_id, get_max_id(child))
    return max_id


def remap_ids(node, id_counter):
    """重新映射书签ID和GUID"""
    new_node = copy.deepcopy(node)
    new_node["id"] = str(id_counter[0])
    id_counter[0] += 1

    if "guid" in new_node:
        new_node["guid"] = str(uuid.uuid4())

    # 更新时间戳
    now = str(int(time.time() * 1000000) + 116444736000000000)
    if new_node.get("type") == "folder":
        new_node["date_added"] = now
        new_node["date_modified"] = now
    else:
        new_node["date_added"] = now

    # 移除 Chrome 特有的 meta_info
    if "meta_info" in new_node:
        del new_node["meta_info"]

    for i, child in enumerate(new_node.get("children", [])):
        new_node["children"][i] = remap_ids(child, id_counter)

    return new_node


def calculate_checksum(data):
    """计算 Chromium 书签的 checksum"""
    content = json.dumps(data["roots"], ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.md5(content.encode("utf-8")).hexdigest()


def list_all_folders(node, path=""):
    """列出所有文件夹"""
    folders = []
    if node.get("type") == "folder":
        full_path = f"{path}/{node['name']}" if path else node["name"]
        bookmark_count = len([c for c in node.get("children", []) if c.get("type") == "url"])
        folders.append((full_path, bookmark_count))
        for child in node.get("children", []):
            folders.extend(list_all_folders(child, full_path))
    return folders


def migrate_bookmarks(source_browser, target_browser, folder_name=None, keyword=None, dry_run=False):
    """执行书签迁移"""

    # 1. 获取源和目标书签路径
    source_path = get_bookmarks_path(source_browser)
    target_path = get_bookmarks_path(target_browser)

    if not source_path:
        print(f"❌ 源浏览器 '{source_browser}' 书签文件未找到")
        return False

    if not target_path:
        print(f"❌ 目标浏览器 '{target_browser}' 书签文件未找到")
        return False

    print(f"📂 源: {source_path}")
    print(f"📂 目标: {target_path}")

    # 2. 加载源书签
    if source_browser in ["firefox"]:
        source_data = load_firefox_bookmarks(source_path)
        print("⚠️ Firefox 书签迁移需要额外处理，当前版本暂不支持")
        return False
    elif source_browser in ["safari"]:
        source_data = load_safari_bookmarks(source_path)
        print("⚠️ Safari 书签迁移需要额外处理，当前版本暂不支持")
        return False
    else:
        source_data = load_chromium_bookmarks(source_path)

    # 3. 加载目标书签
    if target_browser in ["firefox", "safari"]:
        print("⚠️ 目标浏览器为 Firefox/Safari，暂不支持写入")
        return False
    else:
        target_data = load_chromium_bookmarks(target_path)

    # 4. 查找要迁移的内容
    items_to_migrate = []

    if folder_name:
        # 按文件夹名称查找
        folder = None
        for root_name, root_node in source_data["roots"].items():
            if isinstance(root_node, dict):
                folder = find_folder(root_node, folder_name)
                if folder:
                    break

        if not folder:
            print(f"❌ 未找到文件夹 '{folder_name}'")
            print("\n可用文件夹:")
            for root_name, root_node in source_data["roots"].items():
                if isinstance(root_node, dict):
                    folders = list_all_folders(root_node)
                    for path, count in folders:
                        print(f"  📁 {path} ({count} 个书签)")
            return False

        items_to_migrate = [folder]
        print(f"✅ 找到文件夹 '{folder_name}'，包含 {len(folder.get('children', []))} 个子项")

    elif keyword:
        # 按关键词查找
        for root_name, root_node in source_data["roots"].items():
            if isinstance(root_node, dict):
                results = find_bookmarks_by_keyword(root_node, keyword)
                items_to_migrate.extend(results)

        if not items_to_migrate:
            print(f"❌ 未找到包含关键词 '{keyword}' 的书签")
            return False

        print(f"✅ 找到 {len(items_to_migrate)} 个匹配的书签")

    else:
        # 全量迁移 - 迁移所有根节点下的内容
        for root_name, root_node in source_data["roots"].items():
            if isinstance(root_node, dict) and root_node.get("children"):
                items_to_migrate.extend(root_node["children"])
        print(f"✅ 全量迁移，共 {len(items_to_migrate)} 个顶级项")

    # 5. 预览模式
    if dry_run:
        print("\n🔍 预览模式（不执行写入）:")
        for item in items_to_migrate:
            if item.get("type") == "folder":
                print(f"  📁 {item['name']} ({len(item.get('children', []))} 个子项)")
            else:
                print(f"  🔗 {item.get('name', 'Unnamed')} - {item.get('url', 'No URL')}")
        return True

    # 6. 备份目标书签
    backup_path = target_path + ".bak_" + time.strftime("%Y%m%d_%H%M%S")
    shutil.copy2(target_path, backup_path)
    print(f"\n💾 已备份目标书签到: {backup_path}")

    # 7. 执行迁移
    max_id = 0
    for root_name, root_node in target_data["roots"].items():
        if isinstance(root_node, dict):
            max_id = max(max_id, get_max_id(root_node))

    id_counter = [max_id + 1]

    for item in items_to_migrate:
        new_item = remap_ids(item, id_counter)
        target_data["roots"]["bookmark_bar"]["children"].append(new_item)

    # 8. 更新 checksum 并写入
    target_data["checksum"] = calculate_checksum(target_data)

    with open(target_path, 'w', encoding='utf-8') as f:
        json.dump(target_data, f, ensure_ascii=False, indent=3)

    print(f"✅ 迁移完成！已写入 {len(items_to_migrate)} 个项目到 {target_browser}")
    print(f"📝 请重启 {target_browser} 以刷新书签")
    return True


def main():
    parser = argparse.ArgumentParser(description="浏览器收藏夹迁移工具")
    parser.add_argument("--source", "-s", required=True, help="源浏览器名称 (chrome/edge/tabbit/brave/arc)")
    parser.add_argument("--target", "-t", required=True, help="目标浏览器名称 (chrome/edge/tabbit/brave/arc)")
    parser.add_argument("--folder", "-f", help="指定要迁移的文件夹名称")
    parser.add_argument("--keyword", "-k", help="按关键词过滤书签")
    parser.add_argument("--dry-run", "-d", action="store_true", help="预览模式，不实际写入")
    parser.add_argument("--list", "-l", action="store_true", help="列出源浏览器的所有文件夹")

    args = parser.parse_args()

    if args.list:
        source_path = get_bookmarks_path(args.source)
        if not source_path:
            print(f"❌ 未找到 {args.source} 的书签文件")
            return

        data = load_chromium_bookmarks(source_path)
        print(f"\n📂 {args.source} 的所有收藏夹:")
        for root_name, root_node in data["roots"].items():
            if isinstance(root_node, dict):
                folders = list_all_folders(root_node)
                for path, count in folders:
                    print(f"  📁 {path} ({count} 个书签)")
        return

    migrate_bookmarks(
        source_browser=args.source,
        target_browser=args.target,
        folder_name=args.folder,
        keyword=args.keyword,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
