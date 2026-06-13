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

/**
 * 语音播放器：维护一个串行队列，逐个处理「加入频道 -> 推流音效 -> 离开频道」。
 * 由于机器人同一时间只能在一个语音房间，所有任务必须串行执行。
 */
export class VoicePlayer {
  private readonly queue: PlayJob[] = [];
  private busy = false;
  private readonly ffmpegPath: string;

  constructor(private readonly api: KookApi, ffmpegPath?: string) {
    this.ffmpegPath = resolveFfmpegPath(ffmpegPath);
    log.info(`使用 ffmpeg：${this.ffmpegPath}`);
  }

  enqueue(job: PlayJob): void {
    this.queue.push(job);
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

    log.info(`触发：${job.label} -> 加入频道 ${job.channelId} 播放音效`);
    const info = await this.api.joinVoice(job.channelId);
    await this.stream(info, soundPath, job.volume);
    log.info('音效播放完成，离开频道。');
    await this.api.leaveVoice(job.channelId);
  }

  /** 使用 ffmpeg 将音频以 opus 编码通过 RTP 推送到 KOOK 媒体服务器。 */
  private stream(info: VoiceJoinResult, soundPath: string, volume: number): Promise<void> {
    const bitrate = info.bitrate && info.bitrate > 0 ? info.bitrate : 48000;
    const rtpUrl = info.rtcp_mux
      ? `rtp://${info.ip}:${info.port}`
      : `rtp://${info.ip}:${info.port}?rtcpport=${info.rtcp_port}`;

    const args = [
      '-nostdin',
      '-loglevel', 'error',
      '-re',
      '-i', soundPath,
      '-map', '0:a:0',
      '-acodec', 'libopus',
      '-b:a', String(bitrate),
      '-ac', '2',
      '-ar', '48000',
      '-filter:a', `volume=${volume}`,
      '-f', 'tee',
      `[select=a:f=rtp:ssrc=${info.audio_ssrc}:payload_type=${info.audio_pt}]${rtpUrl}`,
    ];

    return new Promise<void>((resolvePromise, reject) => {
      const child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const killTimer = setTimeout(() => {
        log.warn('ffmpeg 推流超时，强制结束。');
        child.kill('SIGKILL');
      }, FFMPEG_MAX_MS);

      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(new Error(`无法启动 ffmpeg：${err.message}（请确认已安装 ffmpeg 或保留 ffmpeg-static 依赖）`));
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) {
          resolvePromise();
        } else {
          const tail = stderr.split('\n').filter(Boolean).slice(-4).join(' | ');
          reject(new Error(`ffmpeg 退出码 ${code}。${tail}`));
        }
      });
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
