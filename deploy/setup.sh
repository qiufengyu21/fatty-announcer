#!/usr/bin/env bash
#
# 在 Debian/Ubuntu 的 VM 上一键部署 KOOK 语音音效机器人为 systemd 服务。
#
# 用法（在 VM 上、项目根目录执行）：
#   bash deploy/setup.sh
#
# 前提：当前目录下已存在 .env（含 KOOK_BOT_TOKEN）与 config.json（规则），
#       以及 sounds/ 下的音效文件。
#
set -euo pipefail

NODE_MAJOR=20
SERVICE_NAME="kook-bot"
APP_USER="$(id -un)"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 应用目录：${APP_DIR}"
echo "==> 运行用户：${APP_USER}"

# 1) 安装 Node.js（若未安装或版本 < 18）
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${major}" -ge 18 ]; then need_node=0; fi
fi
if [ "${need_node}" -eq 1 ]; then
  echo "==> 安装 Node.js ${NODE_MAJOR}.x ..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
echo "==> Node 版本：$(node -v)（${NODE_BIN}）"

# 2) 校验必要文件
cd "${APP_DIR}"
[ -f "${APP_DIR}/.env" ] || { echo "❌ 缺少 .env，请先创建并填入 KOOK_BOT_TOKEN。"; exit 1; }
[ -f "${APP_DIR}/config.json" ] || { echo "❌ 缺少 config.json，请先创建并配置规则。"; exit 1; }

# 3) 安装依赖并构建（ffmpeg-static 会自动下载 Linux 版 ffmpeg）
echo "==> 安装依赖 ..."
if [ -f package-lock.json ]; then npm ci; else npm install; fi
echo "==> 编译 TypeScript ..."
npm run build

# 4) 写入并启用 systemd 服务
echo "==> 安装 systemd 服务：${SERVICE_NAME} ..."
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=KOOK Voice SFX Bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

echo ""
echo "==> ✅ 部署完成！"
echo "    查看状态： sudo systemctl status ${SERVICE_NAME}"
echo "    实时日志： journalctl -u ${SERVICE_NAME} -f"
echo "    重启服务： sudo systemctl restart ${SERVICE_NAME}"
echo "    停止服务： sudo systemctl stop ${SERVICE_NAME}"
