import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './logger.js';
import { KookApi } from './kook-api.js';
import { resolveFfmpegPath } from './ffmpeg.js';
import type { VoiceJoinResult } from './types.js';

export interface PlayJob {
  channelId: string;
  sound: string;
  volume: number;
  label: string;
}

// 离开频道后留出的等待时间，避免立即重新加入时因断线重连而报错（文档建议 2~3 秒）。
const LEAVE_COOLDOWN_MS = 2500;
// ffmpeg 推流的最大时长保护，防止异常情况下进程挂死。
const FFMPEG_MAX_MS = 120_000;
// 加入频道后，先等 KOOK 把机器人的语音通道路由到其他客户端，再开始推流。
// 这是真实的墙上时钟等待，才是修复「开头被吞」的关键——在音频里垫静音没用，
// 因为 ffmpeg 会把 adelay 静音瞬间灌完，并不占用真实时间。
// 音效文案已重复 x2 作为兜底，故这里只保留 1.5 秒等待：扛住绝大多数吞音窗口，
// 剩下的零头由第二遍重复覆盖；既比 2 秒响应更快，又不至于归零后在坏网络下连第二遍也被吞。
const JOIN_SETTLE_MS = 1500;
// 在音效前再垫一小段静音作为额外保险（占真实时间很短，几乎无感）。
const LEAD_IN_SILENCE_MS = 250;

/**
 * 语音播放器：维护一个串行队列，逐个处理「加入频道 -> 推流音效 -> 离开频道」。
 * 由于机器人同一时间只能在一个语音房间，所有任务必须串行执行。
 */
export class VoicePlayer {
  private readonly queue: PlayJob[] = [];
  private busy = false;
  private readonly ffmpegPath: string;
  // 上一次播放完整结束（leave 之后）的时间戳，仅用于诊断：计算两次播放之间的空闲间隔，
  // 以便排查「长时间空闲后首次播放没声音」这类冷启动嫌疑。
  private lastPlayEndAt = 0;

  constructor(private readonly api: KookApi, ffmpegPath?: string) {
    this.ffmpegPath = resolveFfmpegPath(ffmpegPath);
    log.info(`使用 ffmpeg：${this.ffmpegPath}`);
  }

  enqueue(job: PlayJob): void {
    this.queue.push(job);
    log.info(`[诊断] 入队任务：${job.label}（频道 ${job.channelId}）；当前队列长度=${this.queue.length}，处理中=${this.busy}`);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        await this.playOne(job);
      } catch (e) {
        log.error(`播放失败（${job.label}）：${(e as Error).message}`);
        // 尽力离开频道，释放资源
        try {
          await this.api.leaveVoice(job.channelId);
        } catch {
          /* ignore */
        }
      }
      await delay(LEAVE_COOLDOWN_MS);
    }
    this.busy = false;
  }

  private async playOne(job: PlayJob): Promise<void> {
    const soundPath = resolve(job.sound);
    if (!existsSync(soundPath)) {
      throw new Error(`音效文件不存在：${soundPath}`);
    }

    const idleMs = this.lastPlayEndAt > 0 ? Date.now() - this.lastPlayEndAt : -1;
    log.info(`========== [诊断] 开始播放任务：${job.label} ==========`);
    log.info(`[诊断] 频道=${job.channelId}，音效=${soundPath}，音量=${job.volume}`);
    log.info(
      `[诊断] 距上次播放结束：${idleMs < 0 ? '本进程首次播放' : `${idleMs}ms（约 ${(idleMs / 1000).toFixed(1)}s）`}` +
        '（长时间空闲后首次播放更易遇到冷启动丢音，是排查重点）',
    );

    // === 阶段 1/4：加入语音频道 ===
    const joinStart = Date.now();
    log.info('[诊断] (1/4) 调用 /voice/join ...');
    const info = await this.api.joinVoice(job.channelId);
    log.info(`[诊断] (1/4) /voice/join 成功，耗时 ${Date.now() - joinStart}ms`);
    log.info(
      `[诊断]       媒体服务器返回：ip=${info.ip} port=${info.port} rtcp_mux=${info.rtcp_mux} ` +
        `rtcp_port=${info.rtcp_port ?? '-'} bitrate=${info.bitrate} ssrc=${info.audio_ssrc} pt=${info.audio_pt}`,
    );

    // === 阶段 2/4：等待语音通道在各客户端就绪（热身窗口）===
    log.info(`[诊断] (2/4) 等待通道就绪 ${JOIN_SETTLE_MS}ms（等 KOOK 把机器人音频路由到其他客户端）...`);
    await delay(JOIN_SETTLE_MS);

    // === 阶段 3/4：ffmpeg 推流 ===
    log.info('[诊断] (3/4) 开始 ffmpeg 推流 ...');
    const streamStart = Date.now();
    await this.stream(info, soundPath, job.volume);
    const streamMs = Date.now() - streamStart;
    log.info(
      `[诊断] (3/4) 推流结束，墙上耗时 ${streamMs}ms` +
        '（用 -re 实时推流，正常应≈音效时长；明显偏短=很可能整段被丢，对照上面 ffmpeg 的 Duration / time= 判断）',
    );

    // === 阶段 4/4：离开频道 ===
    const leaveStart = Date.now();
    log.info('[诊断] (4/4) 调用 /voice/leave ...');
    await this.api.leaveVoice(job.channelId);
    log.info(`[诊断] (4/4) /voice/leave 成功，耗时 ${Date.now() - leaveStart}ms`);

    this.lastPlayEndAt = Date.now();
    log.info(`========== [诊断] 任务完成：${job.label} ==========`);
  }

  /** 使用 ffmpeg 将音频以 opus 编码通过 RTP 推送到 KOOK 媒体服务器。 */
  private stream(info: VoiceJoinResult, soundPath: string, volume: number): Promise<void> {
    const bitrate = info.bitrate && info.bitrate > 0 ? info.bitrate : 48000;
    const rtpUrl = info.rtcp_mux
      ? `rtp://${info.ip}:${info.port}`
      : `rtp://${info.ip}:${info.port}?rtcpport=${info.rtcp_port}`;

    // 先垫静音再调音量：adelay 在头部插入静音，volume 放大响度。
    const filter = `adelay=${LEAD_IN_SILENCE_MS}|${LEAD_IN_SILENCE_MS},volume=${volume}`;

    const args = [
      '-nostdin',
      // 诊断期把日志级别从 error 提升到 info 并强制输出 -stats：
      // info 会打印输入文件的 Duration、流映射、编码器；-stats 会持续打印 time= 进度。
      // 这两项是判断「ffmpeg 是否真的把整段音频推完」的关键依据。
      '-loglevel', 'info',
      '-stats',
      '-re',
      '-i', soundPath,
      '-map', '0:a:0',
      '-acodec', 'libopus',
      '-b:a', String(bitrate),
      '-ac', '2',
      '-ar', '48000',
      '-filter:a', filter,
      '-f', 'tee',
      `[select=a:f=rtp:ssrc=${info.audio_ssrc}:payload_type=${info.audio_pt}]${rtpUrl}`,
    ];

    // 打印完整命令，便于排查时直接复制到终端手动复现。
    log.info(`[诊断] ffmpeg 命令：${this.ffmpegPath} ${args.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')}`);

    return new Promise<void>((resolvePromise, reject) => {
      const startedAt = Date.now();
      const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const killTimer = setTimeout(() => {
        log.warn('[诊断] ffmpeg 推流超时，强制结束。');
        child.kill('SIGKILL');
      }, FFMPEG_MAX_MS);

      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(new Error(`无法启动 ffmpeg：${err.message}（请确认已安装 ffmpeg 或保留 ffmpeg-static 依赖）`));
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        const elapsedMs = Date.now() - startedAt;
        // 无论成功失败，都把 ffmpeg 完整输出打出来（stats 用 \r 覆盖，这里按 \r\n 一起切分）。
        // 末尾的 time= 是「实际推流到第几秒」，对照开头的 Duration 即可判断是否推完整段。
        const lines = stderr.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
        log.info(`[诊断] ffmpeg 退出码=${code}，进程存活 ${elapsedMs}ms，完整输出（${lines.length} 行）如下：`);
        if (lines.length > 0) {
          log.info(lines.map((l) => `    ffmpeg | ${l}`).join('\n'));
        } else {
          log.info('    ffmpeg | （无输出）');
        }
        if (code === 0) {
          resolvePromise();
        } else {
          reject(new Error(`ffmpeg 退出码 ${code}（详见上方完整输出）`));
        }
      });
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
