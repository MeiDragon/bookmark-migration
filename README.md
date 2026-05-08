# bookmark-migration

用于在浏览器之间迁移收藏夹，支持一键全量迁移或指定特定文件夹/网址迁移。

## 功能特性

- ✅ **一键全量迁移** - 将整个浏览器的书签迁移到另一个浏览器
- ✅ **指定文件夹迁移** - 只迁移特定的收藏夹
- ✅ **关键词过滤迁移** - 按 URL 或标题关键词筛选书签
- ✅ **预览模式** - 先预览再执行，避免误操作
- ✅ **自动备份** - 迁移前自动备份目标浏览器书签
- ✅ **跨平台支持** - 支持 macOS 和 Windows

## 支持的浏览器

| 浏览器 | 读取 | 写入 |
|--------|------|------|
| Chrome | ✅ | ✅ |
| Edge | ✅ | ✅ |
| Tabbit | ✅ | ✅ |
| Arc | ✅ | ✅ |
| Brave | ✅ | ✅ |
| Firefox | ✅ | ❌ |
| Safari | ✅ | ❌ |

## 快速开始

### 1. 列出源浏览器的所有收藏夹

```bash
node scripts/migrate-bookmarks.mjs -s chrome -l
```

### 2. 预览迁移内容

```bash
node scripts/migrate-bookmarks.mjs \
  -s chrome -t tabbit -f "Frontend-GItHubBlog" -d
```

### 3. 执行迁移

```bash
node scripts/migrate-bookmarks.mjs \
  -s chrome -t tabbit -f "Frontend-GItHubBlog"
```

## 使用示例

### 场景一：全量迁移

```bash
node scripts/migrate-bookmarks.mjs -s chrome -t edge
```

### 场景二：指定文件夹迁移

```bash
node scripts/migrate-bookmarks.mjs \
  -s chrome -t tabbit -f "前端开发"
```

### 场景三：关键词过滤迁移

```bash
node scripts/migrate-bookmarks.mjs \
  -s chrome -t arc -k github
```

## 命令行参数

```
-s, --source  <浏览器>   源浏览器名称 (chrome/edge/tabbit/arc/brave)
-t, --target  <浏览器>   目标浏览器名称 (chrome/edge/tabbit/arc/brave)
-f, --folder  <名称>     指定要迁移的文件夹名称
-k, --keyword <关键词>   按关键词过滤书签
-d, --dry-run            预览模式，不实际写入
-l, --list               列出源浏览器的所有文件夹
-h, --help               显示帮助
```

## 注意事项

1. **备份机制**：每次迁移前会自动备份目标书签文件
2. **浏览器重启**：迁移完成后需要重启目标浏览器才能看到新书签
3. **权限问题**：macOS 可能需要授予 Full Disk Access 权限
4. **Firefox/Safari**：当前版本支持读取但暂不支持写入

## 文件结构

```
bookmark-migration/
├── SKILL.md                          # Skill 定义文件
├── README.md                         # 使用文档
└── scripts/
    └── migrate-bookmarks.mjs         # 主迁移脚本（含列出收藏夹功能）
```
