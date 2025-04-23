import pg from "pg";
import { TrackedTransaction } from "./types.js";
import { safelyReleaseClient } from "./utils.js";

/**
 * 管理活动事务及其生命周期
 */
export class TransactionManager {
  private transactions: Map<string, TrackedTransaction> = new Map();
  private timeoutMs: number;
  private monitorIntervalMs: number;
  private monitorInterval: NodeJS.Timeout | null = null;

  constructor(timeoutMs: number, monitorIntervalMs: number, enableMonitor: boolean = true) {
    this.timeoutMs = timeoutMs;
    this.monitorIntervalMs = monitorIntervalMs;

    if (enableMonitor) {
      this.startMonitor();
    }
  }

  /**
   * 启动事务监视器
   */
  private startMonitor(): void {
    // 清除任何现有的监视器
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    // 创建新的监视器间隔
    this.monitorInterval = setInterval(() => {
      this.checkTransactionTimeouts();
    }, this.monitorIntervalMs);

    // 确保监视器不阻止进程退出
    if (this.monitorInterval) {
      this.monitorInterval.unref();
    }

    console.log(`事务监视器已启动，检查间隔为 ${this.monitorIntervalMs}ms`);
  }

  /**
   * 检查所有活动事务是否已超时
   */
  private checkTransactionTimeouts(): void {
    const now = Date.now();
    
    this.transactions.forEach((transaction, id) => {
      // 检查事务是否已超时
      if (now - transaction.startTime > this.timeoutMs) {
        console.log(`事务 ${id} 已超时，正在回滚...`);
        this.rollbackAndRemove(id, "自动", "事务已超时").catch(err => {
          console.error(`回滚超时事务 ${id} 时出错:`, err);
        });
      }
    });
  }

  /**
   * 将事务添加到管理器
   */
  public addTransaction(id: string, client: pg.PoolClient, sql: string): void {
    this.transactions.set(id, {
      id,
      client,
      startTime: Date.now(),
      sql,
      state: 'active',
      released: false
    });
    
    console.log(`添加了新事务: ${id}`);
  }

  /**
   * 检查管理器是否正在跟踪具有给定 ID 的事务
   */
  public hasTransaction(id: string): boolean {
    return this.transactions.has(id);
  }

  /**
   * 按 ID 获取事务
   */
  public getTransaction(id: string): TrackedTransaction | undefined {
    return this.transactions.get(id);
  }

  /**
   * 从管理器中删除事务
   */
  public removeTransaction(id: string): void {
    const transaction = this.transactions.get(id);
    if (transaction && !transaction.released) {
      safelyReleaseClient(transaction.client);
      transaction.released = true;
    }
    
    this.transactions.delete(id);
    console.log(`已删除事务: ${id}`);
  }

  /**
   * 回滚事务并从管理器中删除它
   */
  public async rollbackAndRemove(id: string, initiator: string, reason: string): Promise<void> {
    const transaction = this.transactions.get(id);
    if (!transaction) {
      console.log(`尝试回滚不存在的事务: ${id}`);
      return;
    }

    // 标记事务为终止中
    transaction.state = 'terminating';
    
    try {
      console.log(`正在回滚事务 ${id} (发起者: ${initiator}, 原因: ${reason})`);
      await transaction.client.query('ROLLBACK');
      console.log(`已成功回滚事务 ${id}`);
    } catch (err) {
      console.error(`回滚事务 ${id} 时出错:`, err);
    } finally {
      this.removeTransaction(id);
    }
  }

  /**
   * 提交事务并从管理器中删除它
   */
  public async commitAndRemove(id: string): Promise<void> {
    const transaction = this.transactions.get(id);
    if (!transaction) {
      throw new Error(`找不到要提交的事务: ${id}`);
    }

    // 标记事务为终止中
    transaction.state = 'terminating';
    
    try {
      await transaction.client.query('COMMIT');
      console.log(`已成功提交事务 ${id}`);
    } finally {
      this.removeTransaction(id);
    }
  }

  /**
   * 获取当前活动事务的数量
   */
  get transactionCount(): number {
    return this.transactions.size;
  }

  /**
   * 销毁并清理事务管理器
   */
  public destroy(): void {
    // 停止监视器
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    // 回滚所有活动事务
    const transactionIds = Array.from(this.transactions.keys());
    for (const id of transactionIds) {
      this.rollbackAndRemove(id, "系统关闭", "系统关闭期间正在清理事务").catch(err => {
        console.error(`系统关闭期间回滚事务 ${id} 时出错:`, err);
      });
    }
  }
} 