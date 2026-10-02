import { Global, Module } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MemoryMatchStore,
  MemoryUserStore,
  MemoryWordStore,
} from './memory-stores';
import { MATCH_STORE, USER_STORE, WORD_STORE, WordRecord } from './stores';

function loadWordRecords(): WordRecord[] {
  const candidates = [
    path.join(__dirname, '..', '..', 'prisma', 'words.json'),
    path.join(process.cwd(), 'prisma', 'words.json'),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    throw new Error(
      `words.json 未找到（已尝试：${candidates.join(', ')}），请先运行 npm run extract-words -w apps/server`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{
    text: string;
    category: WordRecord['category'];
    difficulty: number;
  }>;
  return raw.map((w, i) => ({ id: `word_${i}`, ...w }));
}

/**
 * 存储模块：本期恒为内存实现。
 * DATABASE_URL 配置后（远程 PostgreSQL 就绪）在此按环境切换为 Prisma 实现，接口不变。
 */
@Global()
@Module({
  providers: [
    {
      provide: USER_STORE,
      useFactory: () => {
        warnIfDatabaseUrl();
        return new MemoryUserStore();
      },
    },
    {
      provide: WORD_STORE,
      useFactory: () => new MemoryWordStore(loadWordRecords()),
    },
    {
      provide: MATCH_STORE,
      useFactory: () => new MemoryMatchStore(),
    },
  ],
  exports: [USER_STORE, WORD_STORE, MATCH_STORE],
})
export class StorageModule {}

function warnIfDatabaseUrl(): void {
  if (process.env.DATABASE_URL) {
    console.warn(
      '[storage] 检测到 DATABASE_URL，但 Prisma 实现尚未接入，本期继续使用内存仓储。',
    );
  }
}
