import { PoolClient } from 'pg';

/**
 * 安全释放 PostgreSQL 客户端连接
 * @param client PostgreSQL 客户端连接
 */
export function safelyReleaseClient(client: PoolClient | null): void {
  try {
    if (client) {
      client.release();
    }
  } catch (error) {
    console.error('释放 PostgreSQL 客户端时出错:', error);
  }
}

/**
 * 生成唯一的事务ID
 * @returns 事务ID字符串
 */
export function generateTransactionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `tx_${timestamp}_${randomPart}`;
}

/**
 * 检查SQL是否为只读查询
 * @param sql SQL查询字符串
 * @returns 如果是只读查询则为true
 */
export function isReadOnlyQuery(sql: string): boolean {
  const trimmedSql = sql.trim().toLowerCase();
  
  // 检查是否以SELECT, WITH, EXPLAIN或SHOW开头
  return (
    trimmedSql.startsWith('select') ||
    trimmedSql.startsWith('with') ||
    trimmedSql.startsWith('explain') ||
    trimmedSql.startsWith('show')
  );
}
