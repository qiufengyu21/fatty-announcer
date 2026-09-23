import { loadConfig } from './config.js';
import { KookApi } from './kook-api.js';
import { KookGateway } from './gateway.js';
import { VoicePlayer } from './voice-player.js';
import { log } from './logger.js';
import { selectSound } from './sounds.js';
import { TestCommand } from './commands.js';
import type { KookEvent, Rule, TriggerEvent } from './types.js';

// KOOK 系统事件名 -> 内部触发时机。
const EVENT_TRIGGERS: Record<string, TriggerEvent> = {
  joined_channel: 'joined',
  exited_channel: 'exited',
};

async function main(): Promise<void> {
  const { token, config } = loadConfig();
  const api = new KookApi(token);
  const player = new VoicePlayer(api, config.ffmpegPath);

  const cooldownMs = config.cooldownMs ?? 8000;
  const defaultVolume = config.volume ?? 1.0;
  const lastTriggered = new Map<string, number>();

  log.info(`已加载 ${config.rules.length} 条规则：`);
  for (const r of config.rules) {
    const when = (r.event ?? 'joined') === 'exited' ? '离开' : '加入';
    const sounds = r.sounds
      ? r.sounds.map((entry) => `${entry.sound} (weight=${entry.weight})`).join(', ')
      : r.sound;
    log.info(`  · ${r.name ?? r.userId} ${when} ${r.channelId ?? '任意语音频道'} -> ${sounds}`);
  }

  const admins = config.admins ?? [];
  const testCommand = new TestCommand({ admins, aliases: config.aliases ?? {}, api });
  if (admins.length > 0) {
    log.info(`测试命令已对管理员开放：${admins.join(', ')}（在文字频道发送 .test <简称>）`);
  }

  const gateway = new KookGateway(() => api.getGatewayUrl());

  gateway.on('event', (d: KookEvent) => {
    if (!d) return;
    // 非系统事件只可能是管理员的 .test 命令；其余仅关心「用户加入/离开语音频道」系统事件
    if (d.type !== 255) {
      void testCommand.handle(d);
      return;
    }
    const trigger = EVENT_TRIGGERS[d.extra?.type];
    if (!trigger) return;

    const userId = String(d.extra.body?.user_id ?? '');
    const channelId = String(d.extra.body?.channel_id ?? '');
    const ruleUserId = testCommand.effectiveUserId(userId);
    // 同时打印出 user_id / channel_id，方便你查找并填写到 config.json
    const action = trigger === 'exited' ? '离开' : '加入';
    const impersonating = ruleUserId === userId ? '' : `（.test 模拟 ${ruleUserId}）`;
    log.info(`用户${action}语音频道：user_id=${userId} channel_id=${channelId}${impersonating}`);

    const rule = matchRule(config.rules, ruleUserId, channelId, trigger);
    if (!rule) return;

    // 冷却键含触发时机，避免同一用户的「加入」与「离开」规则互相占用冷却。
    const key = `${trigger}:${userId}:${channelId}`;
    const now = Date.now();
    if (now - (lastTriggered.get(key) ?? 0) < cooldownMs) {
      log.info('处于冷却时间内，跳过本次播放。');
      return;
    }
    lastTriggered.set(key, now);

    player.enqueue({
      channelId,
      sound: selectSound(rule),
      volume: rule.volume ?? defaultVolume,
      label: rule.name ?? userId,
    });
  });

  await gateway.start();
  log.info('机器人已启动，正在监听语音频道加入/离开事件。按 Ctrl+C 退出。');

  const shutdown = () => {
    log.info('正在关闭...');
    gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function matchRule(
  rules: Rule[],
  userId: string,
  channelId: string,
  trigger: TriggerEvent,
): Rule | undefined {
  return rules.find(
    (r) =>
      r.userId === userId &&
      (r.event ?? 'joined') === trigger &&
      (!r.channelId || r.channelId === channelId),
  );
}

main().catch((e) => {
  log.error((e as Error).message);
  process.exit(1);
});
