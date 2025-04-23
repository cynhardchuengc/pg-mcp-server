#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";

import config from "./config.js";
import { TransactionManager } from "./transaction-manager.js";
import { safelyReleaseClient } from "./utils.js";
import {
  handleExecuteQuery,
  handleExecuteDML,
  handleExecuteCommit,
  handleExecuteRollback,
  handleListTables,
  handleDescribeTable
} from "./tool-handlers.js";

// 处理命令行参数
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("请提供数据库 URL 作为命令行参数");
  process.exit(1);
}

const databaseUrl = args[0];
const resourceBaseUrl = new URL(databaseUrl);
resourceBaseUrl.protocol = "postgres:";
resourceBaseUrl.password = ""; // 出于安全考虑删除密码

// 创建具有配置设置的连接池
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: config.pg.maxConnections,
  idleTimeoutMillis: config.pg.idleTimeoutMillis,
  statement_timeout: config.pg.statementTimeout,
});

// 创建事务管理器
const transactionManager = new TransactionManager(
  config.transactionTimeoutMs,
  config.monitorIntervalMs,
  config.enableTransactionMonitor
);

// 创建 MCP 服务器
const server = new McpServer(
  {
    name: "postgres-full-access",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// 辅助函数，将处理程序响应转换为正确的格式
function transformHandlerResponse(result: any) {
  if (!result) return result;

  const transformedResult = { ...result };

  if (result.content) {
    transformedResult.content = result.content.map((item: any) => {
      if (item.type === "text") {
        return {
          type: "text" as const,
          text: item.text,
        };
      }
      return item;
    });
  }

  return transformedResult;
}

// 注册工具
server.tool(
  "execute_query",
  "运行只读 SQL 查询（SELECT 语句）。以只读模式执行以确保安全。",
  { sql: z.string().describe("要执行的 SQL 查询（仅 SELECT）") },
  async (args, extra) => {
    try {
      const result = await handleExecuteQuery(pool, args.sql);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_dml_ddl_dcl_tcl",
  "执行 DML、DDL、DCL 或 TCL 语句（INSERT、UPDATE、DELETE、CREATE、ALTER、DROP 等）。自动包装在需要显式提交或回滚的事务中。重要提示：执行后，会话将结束，以便用户查看结果并决定。",
  { sql: z.string().describe("要执行的 SQL 语句 - 执行后立即结束会话，以便用户查看并回复'是'以提交或'否'以回滚") },
  async (args, extra) => {
    try {
      // 检查事务限制
      if (
        transactionManager.transactionCount >= config.maxConcurrentTransactions
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  message: `已达到最大并发事务限制（${config.maxConcurrentTransactions}）。请稍后重试。`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const result = await handleExecuteDML(
        pool,
        transactionManager,
        args.sql,
        config.transactionTimeoutMs
      );
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_commit",
  "通过 ID 提交事务以永久应用对数据库的更改",
  { transaction_id: z.string().describe("要提交的事务的 ID - 这将永久保存所有更改到数据库") },
  async (args, extra) => {
    try {
      const result = await handleExecuteCommit(
        transactionManager,
        args.transaction_id
      );
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_rollback",
  "通过 ID 回滚事务以撤消所有更改并丢弃事务",
  { transaction_id: z.string().describe("要回滚的事务的 ID - 这将丢弃所有更改") },
  async (args, extra) => {
    try {
      const result = await handleExecuteRollback(
        transactionManager,
        args.transaction_id
      );
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_tables",
  "获取数据库中所有表的列表",
  {},
  async (args, extra) => {
    try {
      const result = await handleListTables(pool);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "describe_table",
  "获取有关特定表的详细信息",
  { table_name: z.string().describe("要描述的表的名称") },
  async (args, extra) => {
    try {
      const result = await handleDescribeTable(pool, args.table_name);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

async function runServer() {
  try {
    // 使用标准输入/输出设置 MCP 服务器传输
    const transport = new StdioServerTransport();
    
    // 连接并启动服务器
    await server.connect(transport);
    console.log(`PostgreSQL 全访问 MCP 服务器已启动`);
    console.log(`连接到数据库：${resourceBaseUrl.toString()}`);
    console.log(`事务超时：${config.transactionTimeoutMs}ms`);
    console.log(`最大并发事务：${config.maxConcurrentTransactions}`);
    
    // 创建一个永不解决的Promise，让服务器保持运行
    await new Promise(() => {});
    
    console.log("服务器已正常关闭");
  } catch (error) {
    console.error("服务器遇到错误：", error);
    process.exit(1);
  } finally {
    // 清理资源
    transactionManager.destroy();
    await pool.end();
  }
}

// 处理进程级别信号
process.on("SIGINT", async () => {
  console.log("收到 SIGINT 信号，正在关闭...");
  transactionManager.destroy();
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("收到 SIGTERM 信号，正在关闭...");
  transactionManager.destroy();
  await pool.end();
  process.exit(0);
});

// 启动服务器
runServer().catch((error) => {
  console.error("启动服务器时出错：", error);
  process.exit(1);
});

async function testConnection() {
  let client = null;
  try {
    console.log('正在尝试连接数据库...');
    client = await pool.connect();
    console.log('数据库连接成功!');
    
    const result = await client.query('SELECT current_database() as db_name');
    console.log(`当前连接的数据库: ${result.rows[0].db_name}`);
    
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('\n数据库中的表:');
    if (tablesResult.rows.length > 0) {
      tablesResult.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.table_name}`);
      });
    } else {
      console.log('没有找到表');
    }
    
  } catch (error) {
    console.error('数据库连接错误:', error);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
    console.log('数据库连接已关闭');
  }
}

// 运行测试连接
testConnection().catch(err => {
  console.error('程序执行出错:', err);
  process.exit(1);
}); 