#!/usr/bin/env node
/**
 * 从 Mindustry 中文语言包提取「你猜我画」受控词库，生成 prisma/words.json。
 * 幂等：相同输入 → 相同输出（确定性排序 + 稳定 JSON 格式）。
 * 用法：node scripts/extract-words.mjs [bundle.properties 路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('ts-node').register({
  transpileOnly: true,
  project: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tsconfig.json'),
});
const { parseProperties, buildWordList } = require('../src/words/word-rules.ts');

const DEFAULT_SOURCE =
  'C:\\Users\\43551\\Desktop\\Mindustry-master\\core\\assets\\bundles\\bundle_zh_CN.properties';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = process.argv[2] ?? DEFAULT_SOURCE;
const outPath = path.join(scriptDir, '..', 'prisma', 'words.json');

const raw = fs.readFileSync(sourcePath, 'utf8');
const entries = parseProperties(raw);
const { words, counts, maxNameLength, warnings } = buildWordList(entries);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(words, null, 2)}\n`, 'utf8');

console.log(`source: ${sourcePath}`);
console.log(`parsed entries: ${entries.length}`);
console.log(`max name length used: ${maxNameLength}`);
for (const [cat, n] of Object.entries(counts)) {
  console.log(`  ${cat}: ${n}`);
}
console.log(`total: ${words.length}`);
console.log(`written: ${outPath}`);
for (const w of warnings) {
  console.warn(`WARN ${w}`);
}
