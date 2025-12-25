#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置
const MAX_SIZE = 13 * 1024; // 13 KiB in bytes
const SUBMISSIONS_DIR = 'submissions';
const IGNORE_FILES = ['.gitignore', '.13kibignore', 'README.md', 'LICENSE'];
const IGNORE_PATTERNS = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/*.log'];

// 获取所有提交目录
function getSubmissionDirs() {
  if (!fs.existsSync(SUBMISSIONS_DIR)) {
    console.log('📁 submissions 目录不存在');
    return [];
  }
  
  const entries = fs.readdirSync(SUBMISSIONS_DIR, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(SUBMISSIONS_DIR, entry.name));
}

// 读取 .13kibignore 文件
function getIgnorePatterns(submissionDir) {
  const ignoreFile = path.join(submissionDir, '.13kibignore');
  const patterns = [...IGNORE_PATTERNS];
  
  if (fs.existsSync(ignoreFile)) {
    const content = fs.readFileSync(ignoreFile, 'utf8');
    const localPatterns = content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    patterns.push(...localPatterns.map(p => path.join(submissionDir, p)));
  }
  
  return patterns;
}

// 计算目录大小
function calculateDirectorySize(dir, ignorePatterns = []) {
  let totalSize = 0;
  const invalidFiles = [];
  
  function walk(currentPath) {
    if (!fs.existsSync(currentPath)) return;
    
    const stat = fs.statSync(currentPath);
    
    // 检查是否应该忽略
    const relativePath = path.relative(process.cwd(), currentPath);
    if (ignorePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const minimatch = require('minimatch');
        return minimatch(relativePath, pattern);
      }
      return relativePath.startsWith(pattern);
    })) {
      return;
    }
    
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(currentPath);
      entries.forEach(entry => {
        walk(path.join(currentPath, entry));
      });
    } else if (stat.isFile()) {
      // 跳过忽略的文件
      const fileName = path.basename(currentPath);
      if (IGNORE_FILES.includes(fileName)) {
        return;
      }
      
      const size = stat.size;
      totalSize += size;
      
      if (size > MAX_SIZE) {
        invalidFiles.push({
          file: relativePath,
          size: size,
          sizeFormatted: formatSize(size)
        });
      }
    }
  }
  
  try {
    walk(dir);
  } catch (error) {
    console.error(`❌ 计算 ${dir} 大小时出错:`, error.message);
  }
  
  return { totalSize, invalidFiles };
}

function formatSize(bytes) {
  const kb = bytes / 1024;
  return `${kb.toFixed(2)} KiB (${bytes} 字节)`;
}

// 主检查函数
async function main() {
  console.log('🔍 开始检查 13 KiB 大小限制...\n');
  
  const submissionDirs = getSubmissionDirs();
  
  if (submissionDirs.length === 0) {
    console.log('📭 没有找到提交的作品目录');
    process.exit(0);
  }
  
  let allValid = true;
  const results = [];
  const invalidProjects = [];
  
  for (const dir of submissionDirs) {
    const dirName = path.basename(dir);
    console.log(`📂 检查: ${dirName}`);
    
    const ignorePatterns = getIgnorePatterns(dir);
    const { totalSize, invalidFiles } = calculateDirectorySize(dir, ignorePatterns);
    
    const isValid = totalSize <= MAX_SIZE && invalidFiles.length === 0;
    allValid = allValid && isValid;
    
    if (!isValid) {
      invalidProjects.push(dirName);
    }
    
    results.push({
      directory: dirName,
      size: totalSize,
      sizeFormatted: formatSize(totalSize),
      isValid,
      percentage: ((totalSize / MAX_SIZE) * 100).toFixed(1),
      invalidFiles
    });
    
    console.log(`  大小: ${formatSize(totalSize)}`);
    console.log(`  状态: ${isValid ? '✅ 通过' : '❌ 超过限制'}`);
    console.log(`  使用率: ${((totalSize / MAX_SIZE) * 100).toFixed(1)}%\n`);
    
    if (invalidFiles.length > 0) {
      console.log('  警告: 以下单个文件超过 13 KiB:');
      invalidFiles.forEach(file => {
        console.log(`    ❌ ${file.file}: ${file.sizeFormatted}`);
      });
      console.log();
    }
  }
  
  // 生成输出
  console.log('📊 检查结果汇总:');
  console.log('='.repeat(50));
  
  results.forEach(result => {
    const icon = result.isValid ? '✅' : '❌';
    console.log(`${icon} ${result.directory}: ${result.sizeFormatted} (${result.percentage}%)`);
  });
  
  console.log('='.repeat(50));
  
  // 生成 Markdown 表格
  const sizeTable = `| 项目目录 | 大小 | 状态 | 使用率 |
|----------|------|------|--------|
${results.map(r => `| ${r.directory} | ${r.sizeFormatted} | ${r.isValid ? '✅ 通过' : '❌ 失败'} | ${r.percentage}% |`).join('\n')}`;
  
  // 设置 GitHub Actions 输出
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `all-valid=${allValid}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `invalid-projects=${invalidProjects.join(', ')}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `size-table=${sizeTable.replace(/\n/g, '%0A')}\n`);
  }
  
  // 如果有失败，退出码为非零
  if (!allValid) {
    console.error('\n❌ 错误: 有作品超过 13 KiB 限制');
    process.exit(1);
  }
  
  console.log('\n🎉 所有作品都符合 13 KiB 限制!');
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('❌ 脚本执行出错:', error);
  process.exit(1);
});

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('❌ 脚本执行出错:', error);
    process.exit(1);
  });
}

module.exports = { calculateDirectorySize, getSubmissionDirs };
