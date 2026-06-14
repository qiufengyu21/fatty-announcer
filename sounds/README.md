# 音效文件目录

把你的自定义音效放在这个文件夹里，然后在 `config.json` 的规则里用 `sounds/你的文件名` 引用即可。

- 支持常见格式：`.mp3`、`.wav`、`.ogg`、`.flac`、`.m4a` 等（由 ffmpeg 解码）。
- 建议时长 1~5 秒的短音效，体验最好。
- 文件名尽量用英文/数字，避免空格和特殊字符。

例如放入 `special.mp3` 后，规则里写：

```json
{ "userId": "2418200000", "channelId": "9219038000000", "sound": "sounds/special.mp3" }
```

## 用 edge-tts 免费生成语音（本地、无需 API Key）

[edge-tts](https://github.com/rany2/edge-tts) 调用微软在线语音，免费、无需账号，本地即可生成中文配音：

```powershell
# 安装（仅需一次）
python -m pip install edge-tts

# 生成音效（示例：热血男声，加速 + 提高音量）
python -m edge_tts --voice zh-CN-YunjianNeural --rate=+40% --volume=+30% `
  --text "注意！注意！傻逼胖哥来啦！！！" --write-media sounds/pange-join.mp3
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
