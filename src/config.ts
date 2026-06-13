import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from './types.js';

export interface LoadedConfig {
  token: string;
  config: AppConfig;
}

/** 读取并校验 .env 中的 Token 与 config.json 中的规则。 */
export function loadConfig(): LoadedConfig {
  const token = process.env.KOOK_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      '缺少 KOOK_BOT_TOKEN。请复制 .env.example 为 .env，并填入机器人 Token。',
    );
  }

  const configPath = resolve(process.env.CONFIG_PATH ?? 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(
      `找不到配置文件：${configPath}\n请复制 config.example.json 为 config.json，并按需修改规则。`,
    );
  }

  let parsed: AppConfig;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as AppConfig;
  } catch (e) {
    throw new Error(`解析配置文件失败（请检查 JSON 格式）：${(e as Error).message}`);
  }

  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error('配置文件中的 rules 不能为空，至少需要一条规则。');
  }

  parsed.rules.forEach((r, i) => {
    if (!r.userId || typeof r.userId !== 'string') {
      throw new Error(`第 ${i + 1} 条规则缺少有效的 userId。`);
    }
    if (!r.sound || typeof r.sound !== 'string') {
      throw new Error(`第 ${i + 1} 条规则缺少有效的 sound（音效文件路径）。`);
    }
  });

  return { token, config: parsed };
}
