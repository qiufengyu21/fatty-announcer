import { loadConfig } from './config.js';
import { KookApi } from './kook-api.js';
import { KookGateway } from './gateway.js';
import { VoicePlayer } from './voice-player.js';
import { log } from './logger.js';
import type { KookEvent, Rule } from './types.js';

async function main(): Promise<void> {
  const { token, config } = loadConfig();
  const api = new KookApi(token);
  const player = new VoicePlayer(api, config.ffmpegPath);

  const cooldownMs = config.cooldownMs ?? 8000;
  const defaultVolume = config.volume ?? 1.0;
  const lastTriggered = new Map<string, number>();

  log.info(`已加载 ${config.rules.length} 条规则：`);
  for (const r of config.rules) {
    log.info(`  · ${r.name ?? r.userId} @ ${r.channelId ?? '任意语音频道'} -> ${r.sound}`);
  }

  const gateway = new KookGateway(() => api.getGatewayUrl());

  gateway.on('event', (d: KookEvent) => {
    // 仅关心「用户加入语音频道」系统事件
    if (!d || d.type !== 255 || d.extra?.type !== 'joined_channel') return;

    const userId = String(d.extra.body?.user_id ?? '');
    const channelId = String(d.extra.body?.channel_id ?? '');
    // 同时打印出 user_id / channel_id，方便你查找并填写到 config.json
    log.info(`用户加入语音频道：user_id=${userId} channel_id=${channelId}`);

    const rule = matchRule(config.rules, userId, channelId);
    if (!rule) return;

    const key = `${userId}:${channelId}`;
    const now = Date.now();
    if (now - (lastTriggered.get(key) ?? 0) < cooldownMs) {
      log.info('处于冷却时间内，跳过本次播放。');
      return;
    }
    lastTriggered.set(key, now);

    player.enqueue({
      channelId,
      sound: rule.sound,
      volume: rule.volume ?? defaultVolume,
      label: rule.name ?? userId,
    });
  });

  await gateway.start();
  log.info('机器人已启动，正在监听语音频道加入事件。按 Ctrl+C 退出。');

  const shutdown = () => {
    log.info('正在关闭...');
    gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function matchRule(rules: Rule[], userId: string, channelId: string): Rule | undefined {
  return rules.find(
    (r) => r.userId === userId && (!r.channelId || r.channelId === channelId),
  );
}

main().catch((e) => {
  log.error((e as Error).message);
  process.exit(1);
});
