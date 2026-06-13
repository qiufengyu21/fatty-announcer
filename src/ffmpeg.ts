import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * 解析 ffmpeg 可执行文件路径，优先级：
 * 1. 显式传入的路径 / 环境变量 FFMPEG_PATH
 * 2. 可选依赖 ffmpeg-static 提供的内置二进制
 * 3. 系统 PATH 中的 ffmpeg
 */
export function resolveFfmpegPath(override?: string): string {
  const explicit = override || process.env.FFMPEG_PATH;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  try {
    const ffmpegStatic = require('ffmpeg-static') as string | null;
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // ffmpeg-static 未安装，忽略
  }

  return 'ffmpeg';
}
