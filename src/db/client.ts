import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";

let connection: Promise<Database> | null = null;

/** 首次加载时由 Rust 返回 %APPDATA%\WeightCoach\weightcoach.db 绝对路径并执行 001_init.sql 迁移。 */
export function db(): Promise<Database> {
  connection ??= invoke<string>("db_url").then(async (url) => {
    const database = await Database.load(url);
    // 并发读/短写时等待锁，而不是立刻抛 database is locked
    try {
      await database.execute("PRAGMA busy_timeout = 5000");
      await database.execute("PRAGMA journal_mode = WAL");
      await database.execute("PRAGMA synchronous = NORMAL");
    } catch { /* PRAGMA 失败不阻塞启动 */ }
    return database;
  });
  return connection;
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  // 插件签名 select<T>(): Promise<T>，这里统一约定 T 为单行类型
  const database = await db();
  for (let attempt = 0; ; attempt++) {
    try {
      return await database.select<T[]>(sql, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|SQLITE_BUSY/i.test(message) || attempt >= 7) throw error;
      await sleep(120 * (attempt + 1));
    }
  }
}

export async function selectOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await select<T>(sql, params);
  return rows[0] ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** SQLite 在并发读写下会短暂返回 database is locked；短重试比把错误抛给用户更可靠。 */
export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const database = await db();
  for (let attempt = 0; ; attempt++) {
    try {
      await database.execute(sql, params);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|SQLITE_BUSY/i.test(message) || attempt >= 7) throw error;
      await sleep(120 * (attempt + 1));
    }
  }
}

/** 简单事务包装：SQLite 插件每次 execute 单语句，事务语句显式发出。 */
export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  await execute("BEGIN TRANSACTION");
  try {
    const result = await work();
    await execute("COMMIT");
    return result;
  } catch (error) {
    await execute("ROLLBACK");
    throw error;
  }
}

export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

/** 本地日期 YYYY-MM-DD（SRS 3.5：日期只用本地日，不用 UTC） */
export function todayStr(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
