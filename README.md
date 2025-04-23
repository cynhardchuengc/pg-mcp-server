# PostgreSQL MCP 服务器

基于Model Context Protocol (MCP)的PostgreSQL数据库访问服务器。该服务器允许AI助手安全地执行PostgreSQL数据库操作，包括查询、插入、更新和删除数据，以及表结构操作。

## 目录结构

```
pg-mcp-server/
├── dist/               # 编译后的JavaScript文件
├── src/                # 源代码目录
│   └── lib/            # 核心库文件
│       ├── config.ts           # 配置参数定义
│       ├── index.ts            # 主入口文件和服务器初始化
│       ├── tool-handlers.ts    # 处理各种数据库操作的函数
│       ├── transaction-manager.ts # 事务管理器
│       ├── types.ts            # 类型定义
│       └── utils.ts            # 工具函数
├── package.json        # 项目依赖定义
├── tsconfig.json       # TypeScript编译配置
└── README.md           # 项目说明文档
```

## 核心脚本说明

### src/lib 目录下的脚本

1. **index.ts**
   - 作用：主入口文件，用于初始化和启动MCP服务器。
   - 功能：注册数据库操作工具，设置PostgreSQL连接池，初始化事务管理器，处理命令行参数。
   - 特点：使用MCP SDK创建服务器，注册各种工具函数以处理数据库操作请求。

2. **tool-handlers.ts**
   - 作用：包含所有数据库操作的处理函数。
   - 功能：实现SQL查询执行、数据修改操作、表列表获取、表结构描述等功能。
   - 处理函数：
     - `handleExecuteQuery`: 处理只读SQL查询
     - `handleExecuteDML`: 处理数据修改操作(INSERT, UPDATE, DELETE等)
     - `handleExecuteCommit`: 提交事务
     - `handleExecuteRollback`: 回滚事务
     - `handleListTables`: 列出数据库中的所有表
     - `handleDescribeTable`: 获取表结构详细信息

3. **transaction-manager.ts**
   - 作用：管理数据库事务的生命周期。
   - 功能：跟踪活动事务，处理事务超时，确保资源正确释放。
   - 关键方法：添加、删除、提交和回滚事务，以及监控事务超时。

4. **types.ts**
   - 作用：定义项目中使用的类型和常量。
   - 内容：`TrackedTransaction`接口用于跟踪事务状态，以及其他常量定义。

5. **utils.ts**
   - 作用：提供通用工具函数。
   - 功能：
     - `safelyReleaseClient`: 安全释放PostgreSQL客户端连接
     - `generateTransactionId`: 生成唯一事务ID
     - `isReadOnlyQuery`: 检查SQL是否为只读查询

6. **config.ts**
   - 作用：定义服务器配置项。
   - 内容：事务超时设置、监控间隔、PostgreSQL连接池参数等。
   - 特点：支持通过环境变量覆盖默认配置。

## MCP SDK 的使用

该项目使用Model Context Protocol (MCP) SDK来实现与AI助手的标准化通信：

1. **服务器创建**：
   ```typescript
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
   ```

2. **工具注册**：
   ```typescript
   server.tool(
     "execute_query",
     "运行只读 SQL 查询（SELECT 语句）",
     { sql: z.string().describe("要执行的 SQL 查询") },
     async (args, extra) => {
       // 处理查询
     }
   );
   ```

3. **连接和启动**：
   ```typescript
   const transport = new StdioServerTransport();
   await server.connect(transport);
   ```

## 安装和运行步骤

### 前置条件

- Node.js 18.x 或更高版本
- PostgreSQL 数据库实例
- npm 或 yarn 包管理器

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/cynhardchueng/pg-mcp-server.git
   cd pg-mcp-server
   ```

2. **安装依赖**
   ```bash
   npm install
   ```
   
   如果需要单独安装或更新MCP SDK，请使用：
   ```bash
   npm install @modelcontextprotocol/sdk@1.8.0
   ```

3. **编译TypeScript代码**
   ```bash
   npm run build
   ```

4. **配置Cursor的MCP配置**

   在Cursor编辑器中，需要配置mcp.json文件。一般位于`~/.cursor/mcp.json`，添加以下内容：
   
   ```json
   "pg-mcp-server": {
     "command": "node",
     "args": [
       "项目路径/dist/index.js", 
       "postgresql://用户名:密码@数据库地址:端口/数据库名"
     ],
     "env": {
        "TRANSACTION_TIMEOUT_MS": "60000",
        "MAX_CONCURRENT_TRANSACTIONS": "5",
        "PG_STATEMENT_TIMEOUT_MS": "30000"
     }
   }
   ```
   
   > 注意：请将上述配置中的"项目路径"、"用户名"、"密码"、"数据库地址"、"端口"和"数据库名"替换为实际值。

### 运行服务器

1. **基本运行命令**
   ```bash
   node dist/index.js postgresql://用户名:密码@数据库地址:端口/数据库名
   ```

2. **使用环境变量配置**
   ```bash
   TRANSACTION_TIMEOUT_MS=30000 PG_MAX_CONNECTIONS=30 node dist/index.js postgresql://用户名:密码@数据库地址:端口/数据库名
   ```

### 可用的环境变量

| 环境变量 | 描述 | 默认值 |
|----------|------|--------|
| TRANSACTION_TIMEOUT_MS | 事务超时时间(毫秒) | 15000 |
| MONITOR_INTERVAL_MS | 监控间隔时间(毫秒) | 5000 |
| ENABLE_TRANSACTION_MONITOR | 启用事务监控 | true |
| MAX_CONCURRENT_TRANSACTIONS | 最大并发事务数 | 10 |
| PG_MAX_CONNECTIONS | 连接池最大连接数 | 20 |
| PG_IDLE_TIMEOUT_MS | 空闲连接超时(毫秒) | 30000 |
| PG_STATEMENT_TIMEOUT_MS | SQL语句执行超时(毫秒) | 30000 |

## 示例使用

通过MCP协议，AI助手可以执行以下类型的操作:

1. **执行只读查询**
   ```sql
   SELECT * FROM users WHERE age > 18;
   ```

2. **执行数据修改**
   ```sql
   INSERT INTO users (name, age) VALUES ('张三', 25);
   ```
   
   **重要**：执行数据修改操作(INSERT、UPDATE、DELETE等)后，需要在对话中明确回复"yes"（确认提交）或"no"（回滚事务）。例如：
   ```
   AI: 已执行插入操作，事务ID: tx_12345。请回复"yes"提交事务，或"no"回滚事务。
   用户: yes
   AI: 事务已成功提交，数据已永久保存。
   ```

3. **查看表结构**
   ```
   获取表"users"的详细信息
   ```

4. **列出所有表**
   ```
   列出数据库中的所有表
   ```

## 注意事项

- 确保数据库用户具有适当的权限来执行所需的操作。
- 对于生产环境，建议配置更严格的超时设置和连接池参数。
- 事务会在超时后自动回滚，以防止长时间运行的事务占用资源。
- **数据修改操作**：所有DML操作(INSERT、UPDATE、DELETE)都在事务中执行，必须显式提交才会永久保存。如果用户没有回复"yes"确认提交，或会话结束，事务将自动回滚。
- 请勿在配置文件中使用生产环境的数据库凭据，尤其是在公开分享代码时。 
- 尽量只使用查询分析功能，不要直接对生产库进行增删改，属于高危操作，请慎重





