# Avatar Showcase v0.8 Browser TTS Design

## Goal

在不修改旧 `vrm-showcase-lab`、不引入云端TTS、API密钥、录音上传或声纹采集的前提下，为 `avatar-showcase-lab` 增加纯浏览器语音朗读与嘴型联动。

## Confirmed Scope

- 仅使用浏览器 `speechSynthesis` 和 `SpeechSynthesisUtterance`。
- 不采集麦克风，不录音，不上传音频，不建立声纹。
- 不调用任何云端TTS服务。
- v0.7 的 `AvatarRenderer`、`FrameBlendRenderer`、场景、路由和Capture保持兼容。
- v0.8 在新分支 `avatar-showcase-v0.8` 开发；Production通过全部验收前保持v0.7不变。

## Architecture

### BrowserSpeechEngine

新增独立 `BrowserSpeechEngine`，负责：

- 检测浏览器是否支持 `speechSynthesis`；
- 枚举系统音色；
- 按语言、语速、音调、音量创建 utterance；
- 转发 `start`、`boundary`、`end`、`error` 和 `cancel` 语义事件；
- 确保同一时刻最多只有一条朗读；
- 新朗读开始前取消旧朗读；
- 提供可注入适配器，便于Node单元测试和浏览器自动化模拟。

### SpeechAvatarBridge

新增 `SpeechAvatarBridge`，只依赖 `AvatarController` 的语义接口：

- `start`：保存原状态，切换到 `talk` 和 `soft-smile`；
- `boundary`：根据字符、词边界和节奏更新 `setLipSync()`；
- 无边界事件：使用确定性A/E/U嘴型循环；
- `end`、`error`、`cancel`：嘴型归零并恢复朗读前状态；
- 不访问PixiJS、帧纹理或DOM控件。

### Mouth Timing

浏览器TTS通常不提供真实音素，因此v0.8采用两级策略：

1. 支持 `boundary` 事件时，以事件间隔和字符类别驱动嘴型强度；
2. 不支持或长时间无边界事件时，以180毫秒确定性循环驱动 A/E/U 嘴型。

该方案保证嘴部持续运动，但不宣称达到专业音素级唇形同步。

## UI

Studio新增“浏览器语音”区域：

- 文本输入框；
- 音色选择；
- 语速 `0.6–1.6`；
- 音调 `0.7–1.4`；
- 音量 `0–1`；
- `朗读` 与 `停止`；
- 支持状态说明。

Showcase默认不显示语音控制；可通过公开接口触发。

## Public API

```js
window.__avatarLab.speech = {
  supported: boolean,
  speaking: boolean,
  voices: Array<{ id, name, lang, localService, default }>,
  speak(text, options?): Promise<{ status: 'completed' | 'cancelled' }>,
  stop(): void,
  refreshVoices(): Array<VoiceDescriptor>,
  diagnostics: object,
};
```

同时保留便捷别名：

```js
window.__avatarLab.speak(text, options)
window.__avatarLab.stopSpeaking()
```

## Voice Selection

默认选择顺序：

1. 用户URL或Studio明确指定的 `voice`；
2. `zh-CN` 本地音色；
3. 任意中文音色；
4. 浏览器默认音色；
5. 音色列表第一项。

音色ID使用 `voiceURI || name + lang`，不存储音频和生物特征。

## URL State

新增并恢复：

- `voice`
- `rate`
- `pitch`
- `volume`

文本不默认写入URL，避免敏感或超长内容进入分享链接。

## Error Handling

- 不支持 `speechSynthesis`：Studio显示“不支持浏览器TTS”，朗读按钮禁用；角色功能不受影响。
- 音色列表为空：允许浏览器使用默认音色。
- `speechSynthesis.speak()` 抛错：恢复角色状态并显示错误。
- utterance `error`：Promise拒绝，嘴型归零，恢复原状态。
- 用户停止：Promise以 `cancelled` 结束，不作为错误。
- 页面隐藏或卸载：取消朗读并恢复角色状态。

## Testing

### Unit Tests

- 支持检测；
- 音色排序和选择；
- 参数限幅；
- 新朗读取消旧朗读；
- start/boundary/end/error/cancel事件；
- 无boundary时确定性嘴型循环；
- 停止后恢复原状态；
- 不支持TTS时不影响角色加载。

### Browser Acceptance

云端无头浏览器使用模拟 `speechSynthesis`，验证：

- Studio控件存在；
- `speak()` 切换到talk；
- boundary事件改变嘴型；
- end后恢复idle；
- stop取消朗读；
- URL语音参数刷新恢复；
- Showcase无语音控制面板；
- v0.7原有眨眼、自动循环和Capture回归通过。

真实系统是否发出可听声音依赖用户设备与浏览器，自动化只能验证API调用和状态事件，不能以无头浏览器声卡作为音质证据。

## Acceptance Gates

1. 不新增云端TTS、API密钥、麦克风或录音权限。
2. `BrowserSpeechEngine` 可独立测试。
3. `SpeechAvatarBridge` 不依赖具体渲染器。
4. Studio可选择音色、语速、音调和音量。
5. `window.__avatarLab.speak()` 与 `stopSpeaking()` 可用。
6. 朗读时角色进入talk并产生至少三种嘴型。
7. 朗读结束、错误和停止均恢复原状态。
8. 不支持TTS时页面正常运行并明确降级。
9. v0.7全部核心回归继续通过。
10. Preview/隔离验收通过后才更新Production。

## Non-goals

- 不做声纹采集、声音克隆、说话人识别。
- 不做麦克风输入、ASR或对话模型。
- 不做云端高质量TTS。
- 不承诺音素级嘴型准确度。
