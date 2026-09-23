import { log } from './logger.js';
import type { KookEvent } from './types.js';

/** 发送 .test <简称> 后，模拟该用户的时长。 */
export const IMPERSONATION_MS = 3 * 60_000;

export interface TestCommandDeps {
  admins: string[];
  aliases: Record<string, string>;
  api: {
    sendMessage(channelId: string, content: string, options?: { tempTargetId?: string }): Promise<void>;
  };
  now?: () => number;
}

/**
 * 管理员测试命令：在文字频道发送 .test <简称>（例如 .test pg），
 * 接下来 3 分钟内，管理员自己进出语音频道时会被当作该用户，触发其规则。
 */
export class TestCommand {
  private readonly aliases: Map<string, string>;
  // 管理员 user_id -> 被模拟的用户及到期时间
  private readonly impersonations = new Map<string, { userId: string; expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly deps: TestCommandDeps) {
    this.aliases = new Map(
      Object.entries(deps.aliases).map(([alias, userId]) => [alias.toLowerCase(), userId]),
    );
    this.now = deps.now ?? Date.now;
  }

  /** 匹配规则时应使用的 user_id：管理员处于模拟期内时返回被模拟者。 */
  effectiveUserId(userId: string): string {
    const entry = this.impersonations.get(userId);
    if (!entry) return userId;
    if (this.now() < entry.expiresAt) return entry.userId;
    this.impersonations.delete(userId);
    return userId;
  }

  /** 处理管理员发出的 .test 命令；不是该命令时返回 false。 */
  async handle(d: KookEvent): Promise<boolean> {
    if (d.channel_type !== 'GROUP' || (d.type !== 1 && d.type !== 9) || d.extra?.author?.bot) return false;
    const adminId = String(d.author_id ?? '');
    if (!this.deps.admins.includes(adminId)) return false;

    // KOOK 客户端发出的是 KMarkdown，先去掉转义反斜杠再解析。
    const text = String(d.content ?? '').replace(/\\([\s\S])/g, '$1').trim();
    const match = /^\.test(?:\s+([\s\S]*))?$/i.exec(text);
    if (!match) return false;

    const args = (match[1] ?? '').split(/\s+/).filter(Boolean);
    const alias = args.length === 1 ? args[0].toLowerCase() : undefined;
    const userId = alias ? this.aliases.get(alias) : undefined;

    let reply: string;
    if (alias && userId) {
      this.impersonations.set(adminId, { userId, expiresAt: this.now() + IMPERSONATION_MS });
      reply = `已生效：接下来 ${IMPERSONATION_MS / 60_000} 分钟内，你进出语音频道将被当作 ${alias}（${userId}）。`;
    } else {
      const known = [...this.aliases.keys()].join('、') || '（config.json 未配置 aliases）';
      reply = `用法：.test <简称>，可用简称：${known}`;
    }
    log.info(`[测试命令] 管理员 ${adminId}：${reply}`);

    try {
      await this.deps.api.sendMessage(d.target_id, reply, { tempTargetId: adminId });
    } catch (e) {
      log.warn(`回复测试命令失败：${(e as Error).message}`);
    }
    return true;
  }
}
