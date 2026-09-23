# fatty-announcer · KOOK 语音音效机器人

一个 KOOK（开黑啦）机器人：**当某个特定的人进入（或离开）语音频道时，自动加入该频道播放一段你自定义的音效，然后离开。**

- 监听 KOOK Websocket 网关的「用户加入/离开语音频道」事件（`joined_channel` / `exited_channel`）
- 命中你配置的「用户（可选：+ 频道）+ 触发时机（进入/离开）」规则时，调用语音接口加入频道
- 用 `ffmpeg` 把你的音效以 opus 编码通过 RTP 推流播放，播完自动离开
- 支持多条规则、每条规则按权重随机选择音效、独立音量、可选触发冷却
- 串行队列：同一时间只在一个频道播放，多人同时进入会自动排队逐个播放
- 加入后先等语音通道在各端建立完成再推流，避免开头几个字被吞

> 说明：仓库名为 `fatty-announcer`；本机器人长期部署在一台 Linux 服务器上，以 systemd 服务（`kook-bot`）方式常驻运行。

---

## 一、准备工作

### 1. 安装 Node.js

需要 **Node.js 18 或更高版本**（自带 `fetch`）。在终端执行 `node -v` 确认版本。

### 2. ffmpeg

音效推流依赖 `ffmpeg`（且需支持 `libopus`）。本项目默认会自动安装内置的 `ffmpeg-static`，**通常你不需要手动装**。

如果你的网络无法下载 `ffmpeg-static`，可以改用系统的 ffmpeg：
- 自行安装 ffmpeg 并加入 PATH，或
- 在 `.env` 里设置 `FFMPEG_PATH` 指向 ffmpeg 可执行文件。

### 3. 创建机器人并拿到 Token

1. 打开 [KOOK 开发者中心](https://developer.kookapp.cn/app/index)，创建一个应用。
2. 进入应用的「机器人」页面，**连接模式选择 `Websocket`**。
3. 复制 **Token**（形如 `1/MTA4O...=/xxxx==`）。
4. 在「机器人」页面把机器人**邀请/添加到你的服务器**。
5. 确保机器人在目标语音频道有 **连接语音 / 说话** 权限（否则无法推流）。

### 4. 获取「用户 ID」和「频道 ID」

在 KOOK 客户端里打开 **设置 → 高级设置 → 开发者模式**，然后：
- 右键某个用户头像 → **复制 ID** → 得到 `userId`
- 右键某个语音频道 → **复制 ID** → 得到 `channelId`

> 小技巧：直接启动机器人后，**任何人进入语音频道**时，控制台都会打印
> `用户加入语音频道：user_id=xxx channel_id=yyy`，照着填进配置即可。

---

## 二、安装与配置

在项目根目录（`d:\Projects\kook-bot`）依次执行：

```powershell
# 1. 安装依赖
npm install

# 2. 准备配置文件
Copy-Item .env.example .env
Copy-Item config.example.json config.json
```

然后编辑两个文件：

**`.env`** —— 填入机器人 Token：

```ini
KOOK_BOT_TOKEN=你的机器人Token
```

**`config.json`** —— 配置触发规则：

```json
{
  "cooldownMs": 0,
  "volume": 1.6,
  "admins": ["414517557"],
  "aliases": { "pg": "1407892120" },
  "rules": [
    {
      "name": "胖哥进入",
      "userId": "1407892120",
      "event": "joined",
      "sounds": [
        { "sound": "sounds/join/pange-join.mp3", "weight": 50 },
        { "sound": "sounds/join/pange-dream-wing.mp3", "weight": 50 }
      ],
      "volume": 1.6
    },
    {
      "name": "胖哥离开",
      "userId": "1407892120",
      "event": "exited",
      "sounds": [
        { "sound": "sounds/leave/pange-leave.mp3", "weight": 50 },
        { "sound": "sounds/leave/pange-leave-fast.mp3", "weight": 50 }
      ],
      "volume": 1.6
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `userId` | 是 | 目标用户的 ID |
| `channelId` | 否 | 目标语音频道 ID；**留空 / 不写** 表示该用户进入任意语音频道都会触发 |
| `event` | 否 | 触发时机：`joined`（加入，默认）或 `exited`（离开）；同一人可分别配置进/出两条规则 |
| `sound` | 二选一 | 固定音效路径；与 `sounds` 不能同时配置，兼容旧规则 |
| `sounds` | 二选一 | 非空数组，每项为 `{ "sound": "sounds/join/example.mp3", "weight": 20 }`；权重必须是有限非负数，且至少一个大于 0 |
| `name` | 否 | 仅用于日志显示的名称 |
| `volume` | 否 | 该规则单独音量，`1` 为原始音量，`0.8` 更轻，`1.5` 更响 |
| `cooldownMs` | 否 | 顶层字段，同一用户在同一频道两次触发的最小间隔（毫秒），`0` 表示无冷却；默认 8000 |
| `volume`（顶层） | 否 | 全局默认音量，默认 `1.0` |
| `admins`（顶层） | 否 | 可使用 `.test` 测试命令的 user_id 数组，见「测试新功能」 |
| `aliases`（顶层） | 否 | `.test` 命令用的用户简称，形如 `{ "pg": "1407892120" }`；简称只能含英文字母、数字、下划线，且以字母开头 |

每次通过冷却检查后，独立按 `weight / 总权重` 选择一个音效。权重 `20 / 30 / 50` 对应 `20% / 30% / 50%`，也可以写成 `2 / 3 / 5`，无需合计为 100。短期内可能连续抽到同一个音效，并不保证每十次严格按比例播放。

`weight: 0` 表示停用该音效，不需要删除条目。要固定播放某个音效，将它的权重设为 `100`，其他音效设为 `0` 即可。所有权重都为 `0` 时会在启动时报错。

加入音效放在 `sounds/join/`，离开音效放在 `sounds/leave/`。新增文件后，需要把路径和权重添加到对应规则的 `sounds` 数组并重启机器人；不会自动扫描目录。当前两组各有两个音效，默认各占 50%。你也可以用免费的 `edge-tts` 在本地生成，详见 [sounds/README.md](sounds/README.md)。

---

## 三、运行

### 本地运行（开发 / 测试）

```powershell
npm start
```

运行本地权重选择、配置校验与 `.test` 命令测试（不连接 KOOK）：

```powershell
npm test
```

看到日志 `机器人已启动，正在监听语音频道加入/离开事件。` 即表示成功。让目标用户进入语音频道，机器人会自动加入并播放音效。按 `Ctrl+C` 退出。

### 在服务器上长期运行（systemd，推荐）

项目自带一键部署脚本 [deploy/setup.sh](deploy/setup.sh)：在 Linux（Debian/Ubuntu）服务器上安装 Node、编译，并注册为开机自启的 systemd 服务（服务名 `kook-bot`）。

```bash
# 首次部署（在服务器上、项目根目录执行）
# 前提：已准备好 .env 与 config.json，sounds/ 下有音效文件
sed -i 's/\r$//' deploy/setup.sh   # 若脚本从 Windows 拷来，先去掉 CRLF
bash deploy/setup.sh
```

常用命令：

```bash
sudo systemctl status kook-bot      # 查看状态（含内存占用 Memory: 一行）
journalctl -u kook-bot -f           # 实时日志
sudo systemctl restart kook-bot     # 重启
sudo systemctl stop kook-bot        # 停止
```

服务配置了 `Restart=always` 与开机自启：进程崩溃会自动拉起，服务器重启后也会自动恢复。

### 查看内存 / 资源占用

机器人以 systemd 服务运行，可直接查它的内存占用：

```bash
# 方式一：状态里直接看 Memory: 一行（最直观）
sudo systemctl status kook-bot --no-pager | grep Memory

# 方式二：只取当前内存字节数
sudo systemctl show kook-bot --property=MemoryCurrent

# 方式三：实时刷新（按内存排序，q 退出）
systemd-cgtop
```

> 这是个 Node 进程，常驻内存通常在几十 MB 量级；播放音效时会临时拉起 ffmpeg 子进程，结束后释放。

### 更新 / 部署新功能（已部署后）

在本地改完代码、提交并 `git push` 后，到服务器上执行以下步骤拉取并重新部署：

```bash
cd ~/fatty-announcer
git pull
npm run build          # 已内置自动清理 dist，无需手动 rm
sudo systemctl restart kook-bot
journalctl -u kook-bot -f   # 看日志确认「已加载 N 条规则」并正常启动
```

懒人一行版（在项目目录里直接跑）：

```bash
git pull && npm run build && sudo systemctl restart kook-bot
```

> `npm run build` 会先 `clean`（删除旧 `dist/`）再用 `tsc` 全新编译，确保运行的是最新代码。

**如果 `git pull` 报 “divergent branches”（分支分叉）怎么办？**

当本地用过 `git commit --amend` 或 `git push --force`（改写了历史）后，服务器上的本地分支会和远端分叉。由于服务器上的代码不需要本地改动，直接让本地对齐远端即可：

```bash
git status                 # 先确认没有要保留的本地改动（应显示 working tree clean）
git reset --hard origin/main
```

> `git reset --hard` 会丢弃所有未提交的本地改动，执行前务必先 `git status` 确认干净。
> 想一劳永逸避免分叉提示，可设一次默认：`git config pull.ff only`。

### 测试新功能（.test 命令）

在 `config.json` 里配置好 `admins`（你自己的 user_id）和 `aliases`（用户简称）后，无需再改配置或重启：

1. 在机器人所在服务器的任意文字频道发送 `.test pg`（或 `.test zy` 等）。
2. 机器人会回复一条**仅你可见**的临时消息确认生效。
3. 接下来 **3 分钟**内，你自己进入/离开语音频道时，会被当作 pg，触发 pg 的进/出音效。

说明：

- 只有 `admins` 里的用户发的 `.test` 才会被处理，其他人发送会被忽略。
- 再次发送 `.test <简称>` 会切换目标并重新计时 3 分钟；3 分钟后自动恢复，重启服务也会清除。
- 简称不区分大小写；发送 `.test` 或写错简称时，会回复可用的简称列表。
- 模拟期间日志会显示 `用户加入语音频道：user_id=你的ID ...（.test 模拟 1407892120）`。

> 提示：`config.json` 不需要改代码、不参与编译，改完只要 `sudo systemctl restart kook-bot` 重启即可生效，无需 `npm run build`。

---

## 四、工作原理

```
用户进入语音频道
        │  KOOK 推送 joined_channel 事件
        ▼
   Websocket 网关  ──►  匹配规则（userId + channelId）
        │
        ▼
  POST /api/v3/voice/join      取得媒体服务器 ip/port/ssrc 等
        │
        ▼
  ffmpeg 以 opus + RTP 推流播放音效
        │
        ▼
  POST /api/v3/voice/leave     播完离开，释放资源
```

源码结构：

| 文件 | 作用 |
| --- | --- |
| [src/index.ts](src/index.ts) | 入口：装配各模块、匹配规则、冷却控制 |
| [src/commands.ts](src/commands.ts) | 管理员 `.test <简称>` 命令：3 分钟内把管理员当作指定用户 |
| [src/config.ts](src/config.ts) | 读取并校验 `.env` 与 `config.json` |
| [src/sounds.ts](src/sounds.ts) | 按规则权重随机选择本次播放的音效 |
| [src/kook-api.ts](src/kook-api.ts) | KOOK HTTP 接口封装（网关地址、语音加入/离开、发送消息） |
| [src/gateway.ts](src/gateway.ts) | Websocket 网关：握手、心跳、断线重连、resume |
| [src/voice-player.ts](src/voice-player.ts) | 串行播放队列、加入后等待通道就绪、ffmpeg 推流 |
| [src/ffmpeg.ts](src/ffmpeg.ts) | 解析 ffmpeg 可执行文件路径 |
| [src/types.ts](src/types.ts) | 类型定义（规则、配置、语音加入结果等） |
| [src/logger.ts](src/logger.ts) | 带时间戳的日志输出 |

---

## 五、常见问题

**Q：机器人没反应，控制台也没有「用户加入语音频道」日志？**
- 确认机器人连接模式是 `Websocket` 且 Token 正确。
- 确认机器人已加入该服务器，并能看到该语音频道。

**Q：日志报 `无法启动 ffmpeg`？**
- 说明没找到 ffmpeg。保留 `ffmpeg-static` 依赖（重新 `npm install`），或在 `.env` 设置 `FFMPEG_PATH`。

**Q：报 ffmpeg 退出码非 0，提示 opus 相关错误？**
- 你的 ffmpeg 不支持 `libopus`。建议改用内置 `ffmpeg-static`，它已包含 libopus。

**Q：加入语音失败 / 偶发报错？**
- KOOK 限制同一时间只能加入一个语音房间，离开后需等待 2~3 秒再加入（本项目已自动处理）。
- 确认机器人在该语音频道有「连接语音/说话」权限。

**Q：发送 `.test pg` 没有收到回复？**
- 确认你的 user_id 在 `admins` 里，并且是在服务器的文字频道（不是私信）里发送的。
- 查看日志是否有 `[测试命令]`：有的话说明命令已生效，只是回复失败（通常是机器人在该频道没有发送消息的权限），直接去进出语音频道测试即可。

**Q：能同时监听多个用户 / 多个频道吗？两人同时进来会怎样？**
- 可以，在 `rules` 数组里添加多条规则即可。机器人是单一账号，同一时间只能在一个语音频道；多个触发会自动排队、逐个播放，不会冲突也不会丢，只是靠后的会稍晚一点。

---

## 六、安全提示

- `.env` 内含机器人 Token，**切勿泄露或提交到公共仓库**（已在 `.gitignore` 忽略）。
- 若 Token 泄露，请到开发者中心**重置 Token**。
