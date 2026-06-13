# 音效文件目录

把你的自定义音效放在这个文件夹里，然后在 `config.json` 的规则里用 `sounds/你的文件名` 引用即可。

- 支持常见格式：`.mp3`、`.wav`、`.ogg`、`.flac`、`.m4a` 等（由 ffmpeg 解码）。
- 建议时长 1~5 秒的短音效，体验最好。
- 文件名尽量用英文/数字，避免空格和特殊字符。

例如放入 `special.mp3` 后，规则里写：

```json
{ "userId": "2418200000", "channelId": "9219038000000", "sound": "sounds/special.mp3" }
```
