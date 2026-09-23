# 音效文件目录

加入音效放在 `join/`，离开音效放在 `leave/`，然后在 `config.json` 对应规则里配置文件路径和权重。

当前音效：

| 路径 | 说明 |
| --- | --- |
| `join/pange-join.mp3` | 原加入音效 |
| `join/pange-dream-wing.mp3` | Dream Wing 加入音效 |
| `join/yao-99cheng.mp3` | 照耀加入音效（视频前 10.3 秒，响度已对齐其他音效） |
| `leave/pange-leave.mp3` | 原离开音效 |
| `leave/pange-leave-fast.mp3` | 原离开音效的 1.15 倍速版本，保持音高 |

当前加入、离开规则各有两个候选音效，默认各占 50%。

- 支持常见格式：`.mp3`、`.wav`、`.ogg`、`.flac`、`.m4a` 等（由 ffmpeg 解码）。
- 建议时长 1~5 秒的短音效，体验最好。
- 文件名尽量用英文/数字，避免空格和特殊字符。

例如准备三个加入音效后，规则里写（文件名仅为示例，需要自行提供）：

```json
{
  "userId": "2418200000",
  "event": "joined",
  "sounds": [
    { "sound": "sounds/join/A.mp3", "weight": 20 },
    { "sound": "sounds/join/B.mp3", "weight": 30 },
    { "sound": "sounds/join/C.mp3", "weight": 50 }
  ]
}
```

每次独立随机选择：A 为 20%，B 为 30%，C 为 50%。`weight` 必须是有限非负数，概率为该权重除以总权重；不要求总和为 100。将 `weight` 设为 `0` 即可停用某个音效，无需删除条目。

要固定播放某个音效，将它的权重设为 `100`，其余音效设为 `0`。每条规则至少需要一个大于 `0` 的权重；全部设为 `0` 会在启动时被拒绝。

离开规则使用 `"event": "exited"` 和 `sounds/leave/...` 路径。只需要一个固定音效时，仍可使用 `"sound": "sounds/join/pange-join.mp3"`；同一条规则不能同时设置 `sound` 和 `sounds`。

添加文件不会自动启用：更新 `config.json` 的候选列表和权重后，需要重启机器人。

## 用 edge-tts 免费生成语音（本地、无需 API Key）

[edge-tts](https://github.com/rany2/edge-tts) 调用微软在线语音，免费、无需账号，本地即可生成中文配音：

```powershell
# 安装（仅需一次）
python -m pip install edge-tts

# 生成音效（示例：热血男声，加速 + 提高音量）
python -m edge_tts --voice zh-CN-YunjianNeural --rate=+40% --volume=+30% `
  --text "注意！注意！傻逼胖哥来啦！！！" --write-media sounds/join/pange-join.mp3
```

常用中文音色：

| Voice | 说明 |
| --- | --- |
| `zh-CN-YunjianNeural` | 男声，热血/解说感（当前使用） |
| `zh-CN-YunxiNeural` | 男声，阳光活泼 |
| `zh-CN-XiaoxiaoNeural` | 女声，温暖 |
| `zh-CN-liaoning-XiaobeiNeural` | **东北话**，幽默 |
| `zh-CN-shaanxi-XiaoniNeural` | **陕西话** |
| `zh-HK-WanLungNeural` | **粤语**（男声） |

> 列出全部音色：`python -m edge_tts --list-voices`。
> 提示：把同一句话在 `--text` 里写两遍，可在开头被吞时仍保留完整的第二遍。
