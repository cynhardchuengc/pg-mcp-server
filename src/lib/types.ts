import pg from "pg";

// 常量
export const SCHEMA_PATH = "schema";

// 事务管理
export interface TrackedTransaction {
  id: string;
  client: pg.PoolClient;
  startTime: number;
  sql: string;
  state: 'active' | 'terminating';
  released: boolean; // 跟踪此客户端是否已释放
} 