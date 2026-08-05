# Avatar Showcase v0.7 Design

## Goal

在不修改旧 `vrm-showcase-lab` 的前提下，将现有2.5D关键帧方案重构为可替换渲染器架构，并交付一个可公开访问、无UI、可自动演示的 `/showcase` 动态展示版本。

## Confirmed Direction

- 当前默认路径继续采用 A：预生成关键帧＋浏览器端平滑混合。
- 不把实时 Live2D 或3D作为 v0.7 默认实现。
- 从 v0.7 开始引入 `AvatarRenderer` 抽象，使未来 Live2D/3D 只替换角色内核，不推倒场景、状态机、语音、URL状态和验收链路。
- `vrm-showcase-lab` 的代码、部署、域名和行为均不得修改。
- 当前 Vercel 项目继续为独立的 `avatar-showcase-lab`。
- GitHub连接器目前不能创建新仓库，因此本轮在隔离分支 `avatar-showcase-v0.7` 实施；代码边界必须支持后续整体迁移到独立仓库。

## Architecture

### Renderer Contract

```ts
export interface AvatarRenderer {
  mount(surface: HTMLElement): Promise<void>;
  loadCharacter(asset: CharacterAsset): Promise<void>;
  setState(state: AvatarState): void;
  setExpression(expression: ExpressionState): void;
  setLipSync(value: number): void;
  setLookTarget(target: LookTarget): void;
  update(deltaMs: number): void;
  capture(): Promise<Blob>;
  resize(width: number, height: number, dpr: number): void;
  destroy(): void;
}
```

`AvatarRenderer` 只负责角色呈现。页面路由、场景背景、前景遮挡、情绪语义、自动演示、语音事件和URL状态不得依赖 PixiJS Sprite、Live2D Model 或 Three.js Object3D。

### Current Implementation

`FrameBlendRenderer` 是 v0.7 默认实现：

- 加载预生成透明关键帧；
- 使用两层Sprite进行交叉淡化；
- 对身体容器执行呼吸、肩颈微动、轻微视差；
- 对眨眼和嘴型使用短时间线；
- 不在交互时实时调用GPU；
- GPU运行时仅用于离线或显式重新烘焙关键帧。

### Future Implementations

未来可增加：

- `Live2DRenderer`
- `VrmRenderer`
- `VideoRenderer`

它们必须实现同一接口，并接受相同的 `AvatarState`、`ExpressionState` 和 `LipSync` 输入。

## Frame Set

v0.7 首套角色帧：

- `idle-open.webp`
- `blink-half.webp`
- `blink-closed.webp`
- `happy.webp`
- `listen.webp`
- `mouth-a.webp`
- `mouth-e.webp`
- `mouth-u.webp`

所有帧必须：

- 使用同一正式角色原图；
- 输出尺寸一致；
- 保留原始透明Alpha轮廓；
- 记录表达参数、SHA-256和生成时间；
- 任意两类语义帧不得完全相同。

## State Model

```ts
type AvatarState = 'idle' | 'listen' | 'think' | 'talk' | 'happy';

type ExpressionState = 'neutral' | 'soft-smile' | 'happy' | 'focused';
```

默认展示循环：

```text
idle 8s → happy 4s → listen 5s → talk 6s → idle
```

- `/showcase` 默认 `autoplay=1`。
- 用户点击或指针移动时暂停自动循环5秒。
- `autoplay=0` 时保持安静，只执行自然眨眼和呼吸。
- `/studio` 保留手动控制，不自动演示。

## Routes

- `/studio`：调试和手动状态控制。
- `/showcase`：无控制面板、全屏展示、默认自动循环。
- `/capture`：固定动画时间点和固定视口，供自动截图。
- `/compare`：保留当前对比能力。

## URL State

必须恢复并同步：

- `renderer=frame-blend`
- `character=formal-v1`
- `state`
- `expression`
- `autoplay`
- `scale`
- `x`
- `y`
- `warmth`
- `blur`
- `parallax`
- `exposure`

未知参数应忽略；数值参数必须限幅；刷新后状态必须一致。

## Error Handling

- 关键帧清单或主帧加载失败：显示静态正式角色并标记降级状态。
- 单个次要帧失败：禁用对应动作，不阻塞基础展示。
- 全部角色帧失败：保留背景，显示明确错误，不允许验收绿灯。
- 自动循环异常：停止循环并回到 `idle`。
- 运行时GPU不可用不影响预生成帧播放。

## Acceptance Gates

1. `FrameBlendRenderer` 满足统一接口合同。
2. `/showcase` 无Studio控制面板。
3. 默认自动循环在30秒内至少覆盖 `idle/happy/listen/talk`。
4. 眨眼序列包含 `open → half → closed → half → open`。
5. `talk` 使用至少三种嘴型且帧内容不同。
6. 页面刷新后URL状态完整恢复。
7. `capture` 可在确定时间点得到确定截图。
8. 页面无未捕获异常和致命资源失败。
9. 旧 `vrm-showcase-lab` 不发生任何提交或部署。
10. v0.7 先在隔离分支和Preview验收，通过后才覆盖 `avatar-showcase-lab` Production。

## Non-goals

- 本轮不制作Live2D拆层和Rig。
- 本轮不制作3D模型。
- 本轮不接完整ASR/LLM/TTS闭环。
- 本轮不实现账户、支付或持久化配额系统。
