import pg from "pg";
import { TransactionManager } from "./transaction-manager.js";
import { generateTransactionId, isReadOnlyQuery, safelyReleaseClient } from "./utils.js";

/**
 * 处理执行只读 SQL 查询
 */
export async function handleExecuteQuery(
  pool: pg.Pool,
  sql: string
): Promise<any> {
  // 验证是否为只读查询
  if (!isReadOnlyQuery(sql)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: "此功能只允许执行 SELECT、WITH、EXPLAIN 或 SHOW 查询。请使用 execute_dml_ddl_dcl_tcl 执行数据修改操作。",
            query_type: "non-select",
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  const client = await pool.connect();
  try {
    console.log(`正在执行只读查询: ${sql.substring(0, 100)}...`);
    
    // 开始只读事务
    await client.query('BEGIN TRANSACTION READ ONLY');
    
    // 执行查询
    const startTime = Date.now();
    const result = await client.query(sql);
    const endTime = Date.now();
    const executionTimeMs = endTime - startTime;

    // 结束事务
    await client.query('COMMIT');

    // 准备结果
    const formattedResults = formatQueryResults(result, executionTimeMs);
    console.log(`查询已成功完成，返回 ${result.rowCount ?? 0} 行，用时 ${executionTimeMs}ms`);
    
    return {
      content: [
        {
          type: "text",
          text: formattedResults,
        },
      ],
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(console.error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
            query: sql
          }, null, 2),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

/**
 * 处理执行 DML/DDL/DCL/TCL 语句
 */
export async function handleExecuteDML(
  pool: pg.Pool,
  transactionManager: TransactionManager,
  sql: string,
  timeoutMs: number
): Promise<any> {
  // 检查是否为只读查询 - 这些应使用 execute_query 功能
  if (isReadOnlyQuery(sql)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "warning",
            message: "请使用 execute_query 执行只读查询。此工具用于数据修改操作。",
            query_type: "select",
          }, null, 2),
        },
      ],
      isError: true,
    };
  }

  // 创建客户端
  const client = await pool.connect();
  
  try {
    console.log(`正在执行 SQL: ${sql.substring(0, 100)}...`);
    
    // 开始事务
    await client.query('BEGIN');
    
    // 执行语句
    const startTime = Date.now();
    const result = await client.query(sql);
    const endTime = Date.now();
    const executionTimeMs = endTime - startTime;

    // 直接提交事务
    await client.query('COMMIT');
    
    // 准备结果
    const operation = getOperationType(sql);
    const rowsAffected = result.rowCount ?? 0;
    const formattedResults = JSON.stringify({
      status: "success",
      message: `成功执行并提交了 ${operation}`,
      operation_type: operation,
      rows_affected: rowsAffected,
      execution_time_ms: executionTimeMs
    }, null, 2);

    console.log(`SQL执行成功并已自动提交，影响了${rowsAffected}行`);
    
    return {
      content: [
        {
          type: "text",
          text: formattedResults,
        },
      ]
    };
  } catch (error) {
    // 出错时回滚
    try {
      await client.query('ROLLBACK');
      console.error("SQL执行出错，已回滚事务");
    } catch (rollbackError) {
      console.error("回滚事务时出错:", rollbackError);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
            query: sql
          }, null, 2),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

/**
 * 处理提交事务
 */
export async function handleExecuteCommit(
  transactionManager: TransactionManager,
  transactionId: string
): Promise<any> {
  try {
    // 验证事务是否存在
    if (!transactionManager.hasTransaction(transactionId)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "找不到事务或事务已回滚",
              transaction_id: transactionId
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    // 提交事务
    await transactionManager.commitAndRemove(transactionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            message: "事务已成功提交",
            transaction_id: transactionId
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
            transaction_id: transactionId
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

/**
 * 处理回滚事务
 */
export async function handleExecuteRollback(
  transactionManager: TransactionManager,
  transactionId: string
): Promise<any> {
  try {
    // 验证事务是否存在
    if (!transactionManager.hasTransaction(transactionId)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: "找不到事务或事务已回滚",
              transaction_id: transactionId
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    // 回滚事务
    await transactionManager.rollbackAndRemove(transactionId, "用户请求", "用户明确请求回滚");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            message: "事务已成功回滚",
            transaction_id: transactionId
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
            transaction_id: transactionId
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
}

/**
 * 处理列出所有表
 */
export async function handleListTables(
  pool: pg.Pool
): Promise<any> {
  const client = await pool.connect();
  try {
    const tablesQuery = `
      SELECT 
        t.table_name,
        obj_description(pgc.oid, 'pg_class') as description,
        (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as column_count
      FROM 
        information_schema.tables t
      JOIN 
        pg_catalog.pg_class pgc ON pgc.relname = t.table_name
      WHERE 
        t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
      ORDER BY 
        t.table_name;
    `;
    
    const result = await client.query(tablesQuery);
    
    const tableList = result.rows.map(row => ({
      table_name: row.table_name,
      description: row.description,
      column_count: row.column_count
    }));
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            table_count: tableList.length,
            tables: tableList
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          }, null, 2),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

/**
 * 处理描述表
 */
export async function handleDescribeTable(
  pool: pg.Pool,
  tableName: string
): Promise<any> {
  const client = await pool.connect();
  try {
    // 验证表是否存在
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      );
    `;
    
    const tableExistsResult = await client.query(tableExistsQuery, [tableName]);
    
    if (!tableExistsResult.rows[0].exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `表 '${tableName}' 不存在`,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
    
    // 获取表信息
    const [columns, primaryKeys, foreignKeys, indexes, rowCount] = await Promise.all([
      // 列信息
      client.query(`
        SELECT 
          c.column_name, 
          c.data_type, 
          c.is_nullable, 
          c.column_default,
          col_description(pgc.oid, c.ordinal_position) as description,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale
        FROM 
          information_schema.columns c
        JOIN 
          pg_catalog.pg_class pgc ON pgc.relname = c.table_name
        WHERE 
          c.table_schema = 'public' 
          AND c.table_name = $1
        ORDER BY 
          c.ordinal_position;
      `, [tableName]),
      
      // 主键信息
      client.query(`
        SELECT 
          tc.constraint_name,
          kcu.column_name
        FROM 
          information_schema.table_constraints tc
        JOIN 
          information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE 
          tc.constraint_type = 'PRIMARY KEY' 
          AND tc.table_name = $1
        ORDER BY 
          kcu.ordinal_position;
      `, [tableName]),
      
      // 外键信息
      client.query(`
        SELECT 
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM 
          information_schema.table_constraints tc
        JOIN 
          information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN 
          information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE 
          tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_name = $1;
      `, [tableName]),
      
      // 索引信息
      client.query(`
        SELECT 
          i.relname as index_name,
          a.attname as column_name,
          idx.indisunique as is_unique,
          am.amname as index_type
        FROM 
          pg_catalog.pg_class t
        JOIN 
          pg_catalog.pg_index idx ON t.oid = idx.indrelid
        JOIN 
          pg_catalog.pg_class i ON i.oid = idx.indexrelid
        JOIN 
          pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(idx.indkey)
        JOIN
          pg_catalog.pg_am am ON am.oid = i.relam
        WHERE 
          t.relname = $1
          AND NOT idx.indisprimary
        ORDER BY 
          i.relname, a.attnum;
      `, [tableName]),
      
      // 行数估计
      client.query(`
        SELECT 
          reltuples::bigint AS estimate
        FROM 
          pg_class
        WHERE 
          relname = $1;
      `, [tableName]),
    ]);
    
    // 格式化列
    const columnsInfo = columns.rows.map(col => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      default: col.column_default,
      description: col.description,
      max_length: col.character_maximum_length,
      precision: col.numeric_precision,
      scale: col.numeric_scale
    }));
    
    // 格式化主键
    const primaryKeyColumns = primaryKeys.rows.map(pk => pk.column_name);
    const primaryKeyName = primaryKeys.rows.length > 0 ? primaryKeys.rows[0].constraint_name : null;
    
    // 格式化外键
    const foreignKeysInfo = foreignKeys.rows.map(fk => ({
      name: fk.constraint_name,
      column: fk.column_name,
      references: {
        table: fk.foreign_table_name,
        column: fk.foreign_column_name
      }
    }));
    
    // 格式化索引
    const indexesMap = new Map();
    indexes.rows.forEach(idx => {
      if (!indexesMap.has(idx.index_name)) {
        indexesMap.set(idx.index_name, {
          name: idx.index_name,
          columns: [],
          unique: idx.is_unique,
          type: idx.index_type
        });
      }
      indexesMap.get(idx.index_name).columns.push(idx.column_name);
    });
    const indexesInfo = Array.from(indexesMap.values());
    
    // 格式化表描述
    const tableDescQuery = `
      SELECT 
        obj_description(pgc.oid, 'pg_class') as description
      FROM 
        pg_catalog.pg_class pgc
      WHERE 
        pgc.relname = $1;
    `;
    const tableDescResult = await client.query(tableDescQuery, [tableName]);
    const tableDescription = tableDescResult.rows[0]?.description;
    
    // 返回响应
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            table: {
              name: tableName,
              description: tableDescription,
              estimated_row_count: rowCount.rows[0]?.estimate || 0,
              columns: columnsInfo,
              primary_key: {
                name: primaryKeyName,
                columns: primaryKeyColumns
              },
              foreign_keys: foreignKeysInfo,
              indexes: indexesInfo
            }
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
            table: tableName
          }, null, 2),
        },
      ],
      isError: true,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

// 辅助函数 - 格式化查询结果
function formatQueryResults(result: pg.QueryResult, executionTimeMs: number): string {
  // 对于 SELECT 查询
  if (result.command === 'SELECT') {
    return JSON.stringify({
      status: "success",
      command: result.command,
      row_count: result.rowCount,
      fields: result.fields.map(field => ({
        name: field.name,
        type: field.dataTypeID
      })),
      execution_time_ms: executionTimeMs,
      rows: result.rows
    }, null, 2);
  } 
  
  // 对于非 SELECT 查询
  return JSON.stringify({
    status: "success",
    command: result.command,
    row_count: result.rowCount,
    execution_time_ms: executionTimeMs
  }, null, 2);
}

// 辅助函数 - 获取操作类型
function getOperationType(sql: string): string {
  const normalizedSql = sql.trim().toUpperCase();
  
  if (normalizedSql.startsWith('INSERT')) return 'INSERT';
  if (normalizedSql.startsWith('UPDATE')) return 'UPDATE';
  if (normalizedSql.startsWith('DELETE')) return 'DELETE';
  if (normalizedSql.startsWith('CREATE')) return 'CREATE';
  if (normalizedSql.startsWith('ALTER')) return 'ALTER';
  if (normalizedSql.startsWith('DROP')) return 'DROP';
  if (normalizedSql.startsWith('TRUNCATE')) return 'TRUNCATE';
  if (normalizedSql.startsWith('GRANT')) return 'GRANT';
  if (normalizedSql.startsWith('REVOKE')) return 'REVOKE';
  
  return '未知操作';
} 