/** 一条触发规则：当某用户进入（指定）语音频道时，播放某个音效。 */
export interface Rule {
  /** 目标用户的 user_id（必填）。 */
  userId: string;
  /** 目标语音频道的 channel_id。留空或省略表示任意语音频道都会触发。 */
  channelId?: string;
  /** 音效文件路径（相对于项目根目录或绝对路径）。 */
  sound: string;
  /** 可选：仅用于日志显示的名称。 */
  name?: string;
  /** 可选：该规则单独的音量（0~2，1 为原始音量）。 */
  volume?: number;
}

/** config.json 的结构。 */
export interface AppConfig {
  rules: Rule[];
  /** 同一用户在同一频道触发的最小间隔（毫秒），默认 8000。 */
  cooldownMs?: number;
  /** 全局默认音量（0~2，1 为原始音量），默认 1。 */
  volume?: number;
  /** 可选：自定义 ffmpeg 路径，优先级低于环境变量 FFMPEG_PATH。 */
  ffmpegPath?: string;
}

/** /api/v3/voice/join 接口返回的数据。 */
export interface VoiceJoinResult {
  ip: string;
  port: string;
  rtcp_port?: number;
  rtcp_mux: boolean;
  bitrate: number;
  audio_ssrc: string;
  audio_pt: string;
}

/** Websocket 信令 s=0 时 d 字段的事件结构（仅列出本项目用到的字段）。 */
export interface KookEvent {
  /** 系统消息固定为 255。 */
  type: number;
  channel_type: string;
  target_id: string;
  author_id: string;
  content: string;
  extra: {
    /** 系统事件的具体类型，例如 joined_channel。 */
    type: string;
    body: Record<string, unknown>;
  };
  msg_id: string;
  msg_timestamp: number;
}
