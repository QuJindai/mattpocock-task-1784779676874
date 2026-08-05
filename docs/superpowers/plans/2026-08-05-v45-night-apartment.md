# V4.5 Night Apartment Atmosphere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V4.4 的暗化日间客厅替换为可重复验证的程序化暖色夜景公寓，并保持现有模型、动作与取景能力不回归。

**Architecture:** 继续使用自包含 gzip 单文件部署。背景由独立 DOM 图层和 CSS 渐变构成；Three.js 只渲染人物和接触阴影。GitHub Actions 使用 Runner 自带 Chrome 连续执行夜景氛围门、自然挥手门、真实近景门和完整回归。

**Tech Stack:** HTML/CSS, Three.js, @pixiv/three-vrm, Vercel static deployment, Playwright, GitHub Actions.

## Global Constraints
- 不修改 Alicia 模型 URL。
- 不修改 V4.4 自然挥手骨骼参数。
- 不修改 V4.4 标准/近景自动取景倍率。
- 不使用远程背景图片。
- 固定线上地址保持 `https://vrm-showcase-lab.vercel.app`。

---

### Task 1: Night apartment layers

**Files:**
- Modify: local V4.4 HTML source used for Production deployment
- Test: generated HTML static assertions

- [ ] Replace `.bg` remote image background with CSS-only wall, floor, window, skyline, sofa, lamp and foreground layers.
- [ ] Add static assertions that no `images.unsplash.com` reference remains and all night-scene class names exist.
- [ ] Run JavaScript module syntax check and gzip round-trip SHA check.

### Task 2: Warm/cool lighting

**Files:**
- Modify: Three.js light declarations in the same HTML source

- [ ] Lower hemisphere intensity and shift sky/ground colors toward night values.
- [ ] Use warm key and point light from camera-left; strengthen cool rim from window-right.
- [ ] Keep exposure and material tuning unchanged.
- [ ] Verify exact light constants through static assertions.

### Task 3: Production deployment

**Files:**
- Create: compressed self-contained `index.html` payload for Vercel

- [ ] Update title, UI copy and buildId to V4.5.
- [ ] Deploy to existing `vrm-showcase-lab` Production project.
- [ ] Poll deployment until READY and verify fixed domain returns V4.5 marker.

### Task 4: Acceptance

**Files:**
- Create: `v45-night-smoke.mjs`
- Create: `.github/workflows/v45-acceptance.yml`

- [ ] Add DOM and computed-style assertions proving no remote background and all night layers are visible.
- [ ] Sample page screenshot regions to verify warm-left/cool-right luminance and color bias.
- [ ] Run existing closeup, wave and full visual gates against V4.5 without loosening thresholds.
- [ ] Upload screenshots and JSON evidence even on failure.
- [ ] Inspect final contact sheet before declaring V4.5 baseline.
