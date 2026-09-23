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
    if (!r || !r.userId || typeof r.userId !== 'string') {
      throw new Error(`第 ${i + 1} 条规则缺少有效的 userId。`);
    }
    if (r.sounds !== undefined) {
      if (r.sound !== undefined) {
        throw new Error(`第 ${i + 1} 条规则不能同时配置 sound 和 sounds。`);
      }
      if (!Array.isArray(r.sounds) || r.sounds.length === 0) {
        throw new Error(`第 ${i + 1} 条规则的 sounds 必须是非空数组。`);
      }
      for (const entry of r.sounds) {
        if (!entry || typeof entry.sound !== 'string' || !entry.sound.trim()) {
          throw new Error(`第 ${i + 1} 条规则的 sounds 缺少有效的 sound 路径。`);
        }
        if (!Number.isFinite(entry.weight) || entry.weight < 0) {
          throw new Error(`第 ${i + 1} 条规则的 sounds 中 weight 必须是有限非负数。`);
        }
      }
      const totalWeight = r.sounds.reduce((total, entry) => total + entry.weight, 0);
      if (!Number.isFinite(totalWeight)) {
        throw new Error(`第 ${i + 1} 条规则的 sounds 总 weight 超出有效范围。`);
      }
      if (totalWeight === 0) {
        throw new Error(`第 ${i + 1} 条规则的 sounds 至少需要一个 weight 大于 0 的音效。`);
      }
    } else if (typeof r.sound !== 'string' || !r.sound.trim()) {
      throw new Error(`第 ${i + 1} 条规则缺少有效的 sound 或 sounds。`);
    }
    if (r.event !== undefined && r.event !== 'joined' && r.event !== 'exited') {
      throw new Error(`第 ${i + 1} 条规则的 event 只能是 "joined" 或 "exited"。`);
    }
  });

  if (
    parsed.admins !== undefined &&
    (!Array.isArray(parsed.admins) || parsed.admins.some((id) => typeof id !== 'string' || !id.trim()))
  ) {
    throw new Error('admins 必须是由 user_id 字符串组成的数组。');
  }

  if (parsed.aliases !== undefined) {
    if (!parsed.aliases || typeof parsed.aliases !== 'object' || Array.isArray(parsed.aliases)) {
      throw new Error('aliases 必须是 { "简称": "user_id" } 形式的对象。');
    }
    const seen = new Set<string>();
    for (const [alias, userId] of Object.entries(parsed.aliases)) {
      const key = alias.toLowerCase();
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        throw new Error(`aliases 中的简称 "${alias}" 只能包含英文字母、数字和下划线，且以字母开头。`);
      }
      if (seen.has(key)) {
        throw new Error(`aliases 中的简称 "${alias}" 重复（不区分大小写）。`);
      }
      seen.add(key);
      if (typeof userId !== 'string' || !userId.trim()) {
        throw new Error(`aliases 中简称 "${alias}" 对应的 user_id 无效。`);
      }
    }
  }

  return { token, config: parsed };
}
