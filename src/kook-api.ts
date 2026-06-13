import type { VoiceJoinResult } from './types.js';

const API_BASE = 'https://www.kookapp.cn/api/v3';

/** KOOK 常规 HTTP 接口的简单封装。 */
export class KookApi {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bot ${this.token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
    } catch (e) {
      throw new Error(`请求 ${path} 网络错误：${(e as Error).message}`);
    }

    const text = await res.text();
    let json: { code?: number; message?: string; data?: unknown } = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // 非 JSON 响应（例如限流页面），下面统一报错
    }

    if (!res.ok || (typeof json.code === 'number' && json.code !== 0)) {
      const code = json.code ?? res.status;
      const msg = json.message || res.statusText || '未知错误';
      throw new Error(`KOOK 接口 ${path} 失败 (code=${code})：${msg}`);
    }

    return json.data as T;
  }

  /** 获取 Websocket 网关地址（compress=0 表示不压缩，便于直接解析 JSON）。 */
  async getGatewayUrl(): Promise<string> {
    const data = await this.request<{ url: string }>('/gateway/index?compress=0');
    return data.url;
  }

  /** 加入语音频道，返回推流所需的媒体服务器信息。 */
  async joinVoice(channelId: string): Promise<VoiceJoinResult> {
    return this.request<VoiceJoinResult>('/voice/join', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId }),
    });
  }

  /** 离开语音频道，释放推流资源。 */
  async leaveVoice(channelId: string): Promise<void> {
    await this.request('/voice/leave', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId }),
    });
  }
}
