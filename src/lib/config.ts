/**
 * 从环境变量加载的配置设置
 */
export default {
  // 事务超时（毫秒）（默认：15秒）
  transactionTimeoutMs: parseInt(process.env.TRANSACTION_TIMEOUT_MS || '15000', 10),
  
  // 检查卡住事务的频率（默认：5秒）
  monitorIntervalMs: parseInt(process.env.MONITOR_INTERVAL_MS || '5000', 10),
  
  // 启用/禁用事务监视器（默认：启用）
  enableTransactionMonitor: process.env.ENABLE_TRANSACTION_MONITOR !== 'false',
  
  // 最大并发事务数（默认：10）
  maxConcurrentTransactions: parseInt(process.env.MAX_CONCURRENT_TRANSACTIONS || '10', 10),
  
  // PostgreSQL 连接池设置
  pg: {
    // 池应包含的最大客户端数
    maxConnections: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
    
    // 30秒后关闭空闲客户端
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
    
    // 如果查询耗时过长，终止后端
    statementTimeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '30000', 10),
  }
}; 