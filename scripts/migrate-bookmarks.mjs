#!/usr/bin/env node
/**
 * 浏览器收藏夹迁移脚本 (Node.js 版本)
 * 支持 Chrome、Edge、Tabbit、Arc、Brave 等 Chromium 系浏览器
 * 也支持 Firefox/Safari 读取
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ── 浏览器书签路径 ───────────────────────────────────────────
const MACOS_PATHS = {
  chrome:  '~/Library/Application Support/Google/Chrome',
  edge:    '~/Library/Application Support/Microsoft Edge',
  tabbit:  '~/Library/Application Support/Tabbit',
  arc:     '~/Library/Application Support/Arc/User Data',
  brave:   '~/Library/Application Support/BraveSoftware/Brave-Browser',
  firefox: '~/Library/Application Support/Firefox/Profiles',
  safari:  '~/Library/Safari/Bookmarks.plist',
};

const WIN_PATHS = {
  chrome:  '%LOCALAPPDATA%/Google/Chrome/User Data',
  edge:    '%LOCALAPPDATA%/Microsoft/Edge/User Data',
  brave:   '%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data',
  firefox: '%APPDATA%/Mozilla/Firefox/Profiles',
};

function expandHome(p) {
  return p.replace(/^~/, os.homedir());
}

function listProfiles(baseDir) {
  const profiles = [];
  if (!fs.existsSync(baseDir)) return profiles;
  for (const item of fs.readdirSync(baseDir)) {
    const full = path.join(baseDir, item);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const bookmarksPath = path.join(full, 'Bookmarks');
    if (fs.existsSync(bookmarksPath)) {
      profiles.push({ name: item, path: bookmarksPath });
    }
  }
  return profiles;
}

function getBrowserBaseDir(browser) {
  const platform = os.platform();
  const name = browser.toLowerCase();
  let raw;

  if (platform === 'darwin') {
    raw = MACOS_PATHS[name];
  } else if (platform.startsWith('win')) {
    raw = WIN_PATHS[name];
  } else {
    console.error(`❌ 不支持的平台: ${platform}`);
    return null;
  }

  if (!raw) {
    console.error(`❌ 不支持的浏览器: ${name}`);
    return null;
  }

  return expandHome(raw);
}

function getBookmarksPath(browser, profileName = null) {
  const name = browser.toLowerCase();
  const resolved = getBrowserBaseDir(browser);
  if (!resolved) return null;

  if (name === 'firefox') {
    const profileDir = findFirefoxProfile(resolved);
    return profileDir ? path.join(profileDir, 'places.sqlite') : null;
  }
  if (name === 'safari') {
    return fs.existsSync(resolved) ? resolved : null;
  }

  if (profileName) {
    const profilePath = path.join(resolved, profileName, 'Bookmarks');
    if (fs.existsSync(profilePath)) return profilePath;
    console.error(`❌ 未找到 profile '${profileName}' 的书签文件`);
    return null;
  }

  const defaultPath = path.join(resolved, 'Default', 'Bookmarks');
  if (fs.existsSync(defaultPath)) return defaultPath;

  const profiles = listProfiles(resolved);
  if (profiles.length === 0) {
    console.error(`❌ 书签文件不存在: ${resolved}`);
    console.error('   请确认浏览器已安装并运行过至少一次');
    return null;
  }

  if (profiles.length === 1) {
    return profiles[0].path;
  }

  console.error(`❌ 发现多个 ${browser} profile，请用 --profile 指定：`);
  for (const p of profiles) {
    console.error(`   --profile "${p.name}"  →  ${p.path}`);
  }
  return null;
}

function getAllBookmarksPaths(browser) {
  const name = browser.toLowerCase();
  const resolved = getBrowserBaseDir(browser);
  if (!resolved) return [];

  if (name === 'firefox' || name === 'safari') {
    const p = getBookmarksPath(browser);
    return p ? [{ name: name === 'safari' ? 'Safari' : 'Default', path: p }] : [];
  }

  const profiles = listProfiles(resolved);
  if (profiles.length === 0) {
    const defaultPath = path.join(resolved, 'Default', 'Bookmarks');
    if (fs.existsSync(defaultPath)) {
      return [{ name: 'Default', path: defaultPath }];
    }
  }
  return profiles;
}

function findFirefoxProfile(basePath) {
  basePath = expandHome(basePath);
  if (!fs.existsSync(basePath)) return null;
  for (const item of fs.readdirSync(basePath)) {
    if (item.endsWith('.default') || item.endsWith('.default-release')) {
      const full = path.join(basePath, item);
      if (fs.statSync(full).isDirectory()) return full;
    }
  }
  return null;
}

// ── 加载书签 ────────────────────────────────────────────────
function loadChromiumBookmarks(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ── 树操作 ──────────────────────────────────────────────────
function findFolder(node, name) {
  if (node.type === 'folder' && node.name === name) return node;
  for (const child of node.children || []) {
    const found = findFolder(child, name);
    if (found) return found;
  }
  return null;
}

function findBookmarksByKeyword(node, keyword) {
  const results = [];
  const kw = keyword.toLowerCase();
  function search(n) {
    if (n.type === 'url') {
      const nm = (n.name || '').toLowerCase();
      const url = (n.url || '').toLowerCase();
      if (nm.includes(kw) || url.includes(kw)) results.push(n);
    }
    for (const child of n.children || []) search(child);
  }
  search(node);
  return results;
}

function getMaxId(node) {
  let max = parseInt(node.id || '0', 10);
  for (const child of node.children || []) {
    max = Math.max(max, getMaxId(child));
  }
  return max;
}

function remapIds(node, idCounter) {
  const copy = JSON.parse(JSON.stringify(node));
  copy.id = String(idCounter.value++);
  if (copy.guid) copy.guid = crypto.randomUUID();

  const now = String(BigInt(Date.now()) * 1000n + 11644473600000000000n);
  if (copy.type === 'folder') {
    copy.date_added = now;
    copy.date_modified = now;
  } else {
    copy.date_added = now;
  }
  delete copy.meta_info;

  if (copy.children) {
    copy.children = copy.children.map(c => remapIds(c, idCounter));
  }
  return copy;
}

function calculateChecksum(data) {
  const content = JSON.stringify(data.roots, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((acc, key) => {
        acc[key] = v[key];
        return acc;
      }, {});
    }
    return v;
  });
  return crypto.createHash('md5').update(content, 'utf-8').digest('hex');
}

function listAllFolders(node, folderPath = '') {
  const folders = [];
  if (node.type === 'folder') {
    const fullPath = folderPath ? `${folderPath}/${node.name}` : node.name;
    const bookmarkCount = (node.children || []).filter(c => c.type === 'url').length;
    folders.push({ path: fullPath, count: bookmarkCount });
    for (const child of node.children || []) {
      folders.push(...listAllFolders(child, fullPath));
    }
  }
  return folders;
}

// ── 列出收藏夹 ──────────────────────────────────────────────
function listFolders(sourceBrowser, profileName = null) {
  if (profileName) {
    const sourcePath = getBookmarksPath(sourceBrowser, profileName);
    if (!sourcePath) return false;

    const data = loadChromiumBookmarks(sourcePath);
    console.log(`\n📂 ${sourceBrowser.toUpperCase()} (${profileName}) 的所有收藏夹:\n`);

    const allFolders = [];
    for (const [rootName, rootNode] of Object.entries(data.roots || {})) {
      if (rootNode && typeof rootNode === 'object') {
        allFolders.push(...listAllFolders(rootNode));
      }
    }

    if (!allFolders.length) {
      console.log('  (没有收藏夹)');
      return true;
    }

    for (const { path: fp, count } of allFolders.sort((a, b) => a.path.localeCompare(b.path))) {
      const depth = fp.split('/').length - 1;
      const indent = '  '.repeat(depth);
      const name = fp.split('/').pop();
      console.log(`${indent}📁 ${name} (${count} 个书签)`);
    }

    console.log(`\n总计: ${allFolders.length} 个收藏夹`);
    return true;
  }

  // 未指定 profile：遍历所有账户
  const allProfiles = getAllBookmarksPaths(sourceBrowser);
  if (!allProfiles.length) {
    console.error(`❌ 未找到 ${sourceBrowser} 的书签文件`);
    return false;
  }

  let totalFolders = 0;
  for (const { name: pName, path: pPath } of allProfiles) {
    const data = loadChromiumBookmarks(pPath);
    console.log(`\n📂 ${sourceBrowser.toUpperCase()} (${pName}) 的所有收藏夹:\n`);

    const allFolders = [];
    for (const [rootName, rootNode] of Object.entries(data.roots || {})) {
      if (rootNode && typeof rootNode === 'object') {
        allFolders.push(...listAllFolders(rootNode));
      }
    }

    if (!allFolders.length) {
      console.log('  (没有收藏夹)');
      continue;
    }

    for (const { path: fp, count } of allFolders.sort((a, b) => a.path.localeCompare(b.path))) {
      const depth = fp.split('/').length - 1;
      const indent = '  '.repeat(depth);
      const name = fp.split('/').pop();
      console.log(`${indent}📁 ${name} (${count} 个书签)`);
    }

    totalFolders += allFolders.length;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`总计: ${allProfiles.length} 个账户, ${totalFolders} 个收藏夹`);
  return true;
}

// ── 主迁移逻辑 ──────────────────────────────────────────────
function migrateBookmarks({ source, target, folder, keyword, dryRun, profile }) {
  let sourcePath = getBookmarksPath(source, profile);
  let sourceData = null;
  let foundProfile = profile;

  // 如果指定了 profile 但未找到，或没指定 profile 但文件夹搜索需要跨账户
  if (folder && !profile) {
    // 先尝试 Default
    if (sourcePath) {
      sourceData = loadChromiumBookmarks(sourcePath);
      for (const rootNode of Object.values(sourceData.roots || {})) {
        if (rootNode && typeof rootNode === 'object') {
          if (findFolder(rootNode, folder)) {
            foundProfile = 'Default';
            break;
          }
        }
      }
    }
    // Default 没找到，遍历所有 profile
    if (!foundProfile) {
      const allProfiles = getAllBookmarksPaths(source);
      for (const { name: pName, path: pPath } of allProfiles) {
        const data = loadChromiumBookmarks(pPath);
        for (const rootNode of Object.values(data.roots || {})) {
          if (rootNode && typeof rootNode === 'object') {
            if (findFolder(rootNode, folder)) {
              sourcePath = pPath;
              sourceData = data;
              foundProfile = pName;
              console.log(`🔍 在账户 ${pName} 中找到文件夹 '${folder}'`);
              break;
            }
          }
        }
        if (foundProfile) break;
      }
    }
  } else if (!sourceData && sourcePath) {
    sourceData = loadChromiumBookmarks(sourcePath);
  }

  const targetPath = getBookmarksPath(target);

  if (!sourcePath || !targetPath) return false;

  console.log(`📂 源: ${sourcePath}`);
  console.log(`📂 目标: ${targetPath}`);

  const targetData = loadChromiumBookmarks(targetPath);

  let itemsToMigrate = [];

  if (folder) {
    let found = null;
    for (const rootNode of Object.values(sourceData.roots || {})) {
      if (rootNode && typeof rootNode === 'object') {
        found = findFolder(rootNode, folder);
        if (found) break;
      }
    }
    if (!found) {
      console.error(`❌ 未找到文件夹 '${folder}'`);
      console.error('\n可用文件夹:');
      const allProfiles = getAllBookmarksPaths(source);
      for (const { name: pName, path: pPath } of allProfiles) {
        const data = loadChromiumBookmarks(pPath);
        for (const rootNode of Object.values(data.roots || {})) {
          if (rootNode && typeof rootNode === 'object') {
            for (const { path: fp, count } of listAllFolders(rootNode)) {
              console.error(`  [${pName}] 📁 ${fp} (${count} 个书签)`);
            }
          }
        }
      }
      return false;
    }
    itemsToMigrate = [found];
    console.log(`✅ 找到文件夹 '${folder}'，包含 ${found.children?.length || 0} 个子项`);
  } else if (keyword) {
    for (const rootNode of Object.values(sourceData.roots || {})) {
      if (rootNode && typeof rootNode === 'object') {
        itemsToMigrate.push(...findBookmarksByKeyword(rootNode, keyword));
      }
    }
    if (!itemsToMigrate.length) {
      console.error(`❌ 未找到包含关键词 '${keyword}' 的书签`);
      return false;
    }
    console.log(`✅ 找到 ${itemsToMigrate.length} 个匹配的书签`);
  } else {
    for (const rootNode of Object.values(sourceData.roots || {})) {
      if (rootNode && typeof rootNode === 'object' && rootNode.children) {
        itemsToMigrate.push(...rootNode.children);
      }
    }
    console.log(`✅ 全量迁移，共 ${itemsToMigrate.length} 个顶级项`);
  }

  if (dryRun) {
    console.log('\n🔍 预览模式（不执行写入）:');
    for (const item of itemsToMigrate) {
      if (item.type === 'folder') {
        console.log(`  📁 ${item.name} (${item.children?.length || 0} 个子项)`);
      } else {
        console.log(`  🔗 ${item.name || 'Unnamed'} - ${item.url || 'No URL'}`);
      }
    }
    return true;
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupPath = `${targetPath}.bak_${timestamp}`;
  fs.copyFileSync(targetPath, backupPath);
  console.log(`\n💾 已备份目标书签到: ${backupPath}`);

  let maxId = 0;
  for (const rootNode of Object.values(targetData.roots || {})) {
    if (rootNode && typeof rootNode === 'object') {
      maxId = Math.max(maxId, getMaxId(rootNode));
    }
  }

  const idCounter = { value: maxId + 1 };
  const bookmarkBar = targetData.roots?.bookmark_bar;
  if (!bookmarkBar) {
    console.error('❌ 目标书签文件格式异常：缺少 bookmark_bar');
    return false;
  }
  if (!bookmarkBar.children) bookmarkBar.children = [];

  for (const item of itemsToMigrate) {
    bookmarkBar.children.push(remapIds(item, idCounter));
  }

  targetData.checksum = calculateChecksum(targetData);
  fs.writeFileSync(targetPath, JSON.stringify(targetData, null, 3), 'utf-8');

  console.log(`✅ 迁移完成！已写入 ${itemsToMigrate.length} 个项目到 ${target}`);
  console.log(`📝 请重启 ${target} 以刷新书签`);
  return true;
}

// ── CLI ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-s': case '--source':  args.source  = argv[++i]; break;
      case '-t': case '--target':  args.target  = argv[++i]; break;
      case '-f': case '--folder':  args.folder  = argv[++i]; break;
      case '-k': case '--keyword': args.keyword = argv[++i]; break;
      case '-d': case '--dry-run': args.dryRun  = true; break;
      case '-l': case '--list':    args.list    = true; break;
      case '-p': case '--profile': args.profile = argv[++i]; break;
      case '-h': case '--help':    args.help    = true; break;
      default:
        if (arg.startsWith('-')) {
          console.error(`❌ 未知选项: ${arg}`);
          process.exit(1);
        }
    }
  }
  return args;
}

function showHelp() {
  console.log(`
浏览器收藏夹迁移工具 (Node.js)

用法:
  node migrate-bookmarks.mjs [选项]

选项:
  -s, --source  <浏览器>   源浏览器 (chrome/edge/tabbit/arc/brave)
  -t, --target  <浏览器>   目标浏览器 (chrome/edge/tabbit/arc/brave)
  -p, --profile <名称>     源浏览器 profile 名称 (如 Profile 2)
  -f, --folder  <名称>     指定要迁移的文件夹名称
  -k, --keyword <关键词>   按关键词过滤书签
  -d, --dry-run            预览模式，不实际写入
  -l, --list               列出源浏览器的所有文件夹
  -h, --help               显示帮助

示例:
  # 列出 Chrome Default profile 的收藏夹
  node migrate-bookmarks.mjs -s chrome -l

  # 列出 Chrome Profile 2 的收藏夹
  node migrate-bookmarks.mjs -s chrome -p "Profile 2" -l

  # 从 Profile 2 迁移网抑云到 Tabbit
  node migrate-bookmarks.mjs -s chrome -p "Profile 2" -t tabbit -f "网抑云"

  # 预览迁移
  node migrate-bookmarks.mjs -s chrome -t tabbit -f "Frontend-GItHubBlog" -d

  # 执行迁移
  node migrate-bookmarks.mjs -s chrome -t tabbit -f "Frontend-GItHubBlog"

  # 全量迁移
  node migrate-bookmarks.mjs -s chrome -t edge

  # 按关键词迁移
  node migrate-bookmarks.mjs -s chrome -t arc -k github
`);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help || process.argv.length <= 2) {
    showHelp();
    process.exit(0);
  }

  if (args.list) {
    if (!args.source) {
      console.error('❌ 使用 --list 时需要指定 --source');
      process.exit(1);
    }
    const ok = listFolders(args.source, args.profile);
    process.exit(ok ? 0 : 1);
  }

  if (!args.source || !args.target) {
    console.error('❌ 必须指定 --source 和 --target');
    showHelp();
    process.exit(1);
  }

  const ok = migrateBookmarks(args);
  process.exit(ok ? 0 : 1);
}

main();
