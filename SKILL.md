---
name: bookmark-migration
description: 浏览器收藏夹迁移工具。在不同浏览器之间迁移书签/收藏夹，支持一键全量迁移或指定特定文件夹/网址迁移。当用户想要在浏览器之间迁移书签、导入导出收藏夹、同步浏览器书签时使用此skill。支持Chrome、Edge、Firefox、Safari、Tabbit等主流Chromium系和Gecko系浏览器。
---

# 浏览器收藏夹迁移 Skill

跨浏览器书签迁移工具，支持 macOS 和 Windows 平台的主流浏览器。

## 支持的浏览器

### macOS
| 浏览器 | 书签路径 |
|--------|----------|
| Chrome | `~/Library/Application Support/Google/Chrome/Default/Bookmarks` |
| Edge | `~/Library/Application Support/Microsoft Edge/Default/Bookmarks` |
| Firefox | `~/Library/Application Support/Firefox/Profiles/*.default/places.sqlite` |
| Safari | `~/Library/Safari/Bookmarks.plist` |
| Tabbit | `~/Library/Application Support/Tabbit/Default/Bookmarks` |
| Arc | `~/Library/Application Support/Arc/User Data/Default/Bookmarks` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks` |

### Windows
| 浏览器 | 书签路径 |
|--------|----------|
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks` |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Bookmarks` |
| Firefox | `%APPDATA%\Mozilla\Firefox\Profiles\*.default\places.sqlite` |
| Brave | `%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Default\Bookmarks` |

## 使用场景

### 场景一：一键全量迁移
将源浏览器的所有书签迁移到目标浏览器：

```
把Chrome的所有书签导入到Edge
将Firefox书签迁移到Chrome
把Safari收藏夹导出到Tabbit
```

### 场景二：指定文件夹迁移
只迁移特定的收藏夹：

```
把Chrome中"前端开发"文件夹迁移到Tabbit
将Edge的"工作"收藏夹导入到Chrome
```

### 场景三：指定网址迁移
迁移特定的书签项：

```
把Chrome中包含"github"的书签迁移到Arc
将所有LeetCode相关书签从Edge导入到Chrome
```

## 迁移流程

### Step 1: 探测浏览器和书签文件

首先确认源浏览器和目标浏览器的书签文件是否存在：

```bash
# 检测macOS上的浏览器
for browser in "Google/Chrome" "Microsoft Edge" "BraveSoftware/Brave-Browser" "Tabbit"; do
  path="$HOME/Library/Application Support/$browser/Default/Bookmarks"
  if [ -f "$path" ]; then
    echo "✅ Found: $browser"
  fi
done
```

### Step 2: 解析源书签

**Chromium系浏览器**（Chrome/Edge/Tabbit/Brave/Arc）使用JSON格式：

```python
import json
with open(bookmarks_path) as f:
    data = json.load(f)
# 结构: roots -> bookmark_bar/other/mobile -> children
```

**Firefox** 使用SQLite数据库，需要查询 `places.sqlite`。

**Safari** 使用plist格式，需要用 `plistlib` 解析。

### Step 3: 选择迁移内容

根据用户需求过滤书签：
- 全量迁移：直接复制整个书签树
- 文件夹迁移：按文件夹名称匹配
- 网址迁移：按URL或标题关键词匹配

### Step 4: 写入目标书签

1. **备份目标书签文件**（必须！）
2. 解析目标书签JSON
3. 追加新书签到bookmark_bar
4. 重新计算checksum
5. 写回文件

### Step 5: 验证结果

列出迁移后的书签结构，确认迁移成功。

## 核心脚本

使用 bundled script 完成实际的迁移工作：

```bash
# 列出所有收藏夹
node ~/.agents/skills/bookmark-migration/scripts/migrate-bookmarks.mjs -s chrome -l

# 预览迁移
node ~/.agents/skills/bookmark-migration/scripts/migrate-bookmarks.mjs \
  -s chrome -t tabbit -f "Frontend-GItHubBlog" -d

# 执行迁移
node ~/.agents/skills/bookmark-migration/scripts/migrate-bookmarks.mjs \
  -s chrome -t tabbit -f "Frontend-GItHubBlog"
```

## 注意事项

1. **必须备份**：迁移前自动备份目标书签文件
2. **ID重映射**：导入的书签需要分配新ID，避免冲突
3. **GUID生成**：每个书签需要新的UUID
4. **时间戳处理**：使用当前时间作为添加时间
5. **Checksum更新**：写入后重新计算MD5校验和
6. **浏览器重启**：目标浏览器可能需要重启才能刷新书签

## 错误处理

| 错误 | 解决方案 |
|------|----------|
| 源浏览器书签文件不存在 | 提示用户确认浏览器是否已安装并运行过 |
| 目标浏览器书签文件不存在 | 自动创建默认书签结构 |
| 文件夹名称不存在 | 列出所有可用文件夹供用户选择 |
| 目标已存在同名文件夹 | 询问用户是合并、重命名还是跳过 |
| 权限问题 | macOS可能需要Full Disk Access权限 |

## 快速命令

列出源浏览器所有收藏夹：
```bash
python3 ~/.agents/skills/bookmark-migration/scripts/list_folders.py --browser chrome
```

预览迁移内容（不执行）：
```bash
python3 ~/.agents/skills/bookmark-migration/scripts/migrate_bookmarks.py \
  --source chrome --target edge --folder "工作" --dry-run
```
