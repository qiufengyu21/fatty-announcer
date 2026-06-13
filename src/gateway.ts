import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { log } from './logger.js';
import type { KookEvent } from './types.js';

const HEARTBEAT_INTERVAL = 30_000;
const PONG_TIMEOUT = 6_000;
const HELLO_TIMEOUT = 6_000;

// 信令类型（参见 KOOK Websocket 文档）
const SIGNAL = {
  EVENT: 0,
  HELLO: 1,
  PING: 2,
  PONG: 3,
  RESUME: 4,
  RECONNECT: 5,
  RESUME_ACK: 6,
} as const;

type TimerName = 'heartbeatTimer' | 'pongTimer' | 'helloTimer';

export interface KookGateway {
  on(event: 'event', listener: (d: KookEvent) => void): this;
  emit(event: 'event', d: KookEvent): boolean;
}

/**
 * 负责与 KOOK Websocket 网关保持连接：握手、心跳、断线重连与 resume。
 * 收到事件信令（s=0）时通过 'event' 事件向外抛出 d 字段。
 */
export class KookGateway extends EventEmitter {
  private ws?: WebSocket;
  private sn = 0;
  private sessionId = '';
  private heartbeatTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private helloTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private stopped = false;

  constructor(private readonly fetchGatewayUrl: () => Promise<string>) {
    super();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect(false);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = undefined;
    }
  }

  private async connect(resume: boolean): Promise<void> {
    if (this.stopped) return;
    try {
      let url = await this.fetchGatewayUrl();
      if (resume && this.sessionId) {
        const sep = url.includes('?') ? '&' : '?';
        url += `${sep}resume=1&sn=${this.sn}&session_id=${this.sessionId}`;
        log.info('尝试 resume 恢复连接...');
      } else {
        log.info('正在连接 KOOK 网关...');
      }

      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on('open', () => {
        log.info('WebSocket 已连接，等待握手 (HELLO)...');
        this.helloTimer = setTimeout(() => {
          log.warn('等待 HELLO 超时，重新连接。');
          this.reconnect(false);
        }, HELLO_TIMEOUT);
      });
      ws.on('message', (data) => this.onMessage(data));
      ws.on('close', (code) => {
        log.warn(`WebSocket 已关闭 (code=${code})。`);
        this.onDisconnect();
      });
      ws.on('error', (err) => {
        log.warn('WebSocket 错误：' + (err as Error).message);
        // close 事件会紧随其后触发，重连逻辑在 onDisconnect 中处理
      });
    } catch (e) {
      log.error('连接网关失败：' + (e as Error).message);
      this.scheduleReconnect(false);
    }
  }

  private onMessage(data: WebSocket.RawData): void {
    let packet: { s: number; d?: any; sn?: number };
    try {
      packet = JSON.parse(data.toString());
    } catch {
      return;
    }

    switch (packet.s) {
      case SIGNAL.HELLO:
        this.clearTimer('helloTimer');
        if (packet.d?.code === 0) {
          this.sessionId = packet.d.session_id ?? this.sessionId;
          this.reconnectAttempts = 0;
          log.info('握手成功，开始接收事件。');
          this.startHeartbeat();
        } else {
          log.error(`握手失败 (code=${packet.d?.code})，将重新建立连接。`);
          this.resetSession();
          this.reconnect(false);
        }
        break;

      case SIGNAL.EVENT:
        if (typeof packet.sn === 'number') this.sn = packet.sn;
        if (packet.d) this.emit('event', packet.d as KookEvent);
        break;

      case SIGNAL.PONG:
        this.clearTimer('pongTimer');
        break;

      case SIGNAL.RECONNECT:
        log.warn('收到 RECONNECT 信令，重置会话并重连。');
        this.resetSession();
        this.reconnect(false);
        break;

      case SIGNAL.RESUME_ACK:
        if (packet.d?.session_id) this.sessionId = packet.d.session_id;
        log.info('Resume 成功，离线消息已同步。');
        break;

      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.clearTimer('heartbeatTimer');
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL);
  }

  private sendHeartbeat(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ s: SIGNAL.PING, sn: this.sn }));
    } catch {
      return;
    }
    this.clearTimer('pongTimer');
    this.pongTimer = setTimeout(() => {
      log.warn('心跳超时（6 秒内未收到 PONG），尝试重连。');
      this.reconnect(true);
    }, PONG_TIMEOUT);
  }

  private onDisconnect(): void {
    this.clearTimers();
    if (this.stopped) return;
    this.scheduleReconnect(true);
  }

  private reconnect(resume: boolean): void {
    this.clearTimers();
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.terminate();
      } catch {
        /* ignore */
      }
      this.ws = undefined;
    }
    if (this.stopped) return;
    this.scheduleReconnect(resume);
  }

  private scheduleReconnect(resume: boolean): void {
    if (this.stopped) return;
    this.reconnectAttempts++;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 6));
    log.info(`将在 ${Math.round(delay / 1000)} 秒后重连（第 ${this.reconnectAttempts} 次）。`);
    setTimeout(() => {
      void this.connect(resume);
    }, delay);
  }

  private resetSession(): void {
    this.sn = 0;
    this.sessionId = '';
  }

  private clearTimer(name: TimerName): void {
    const t = this[name];
    if (t) {
      clearTimeout(t);
      this[name] = undefined;
    }
  }

  private clearTimers(): void {
    this.clearTimer('heartbeatTimer');
    this.clearTimer('pongTimer');
    this.clearTimer('helloTimer');
  }
}
