import { Application, Assets, Container, Sprite } from 'pixi.js';

function canvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas capture failed')), type, quality);
  });
}

export function createPixiAdapter({ width = 760, height = 920 } = {}) {
  return {
    async mount(surface) {
      const canvas = document.createElement('canvas');
      canvas.className = 'stage';
      canvas.setAttribute('aria-label', 'animated avatar canvas');
      surface.replaceChildren(canvas);

      const app = new Application();
      await app.init({
        canvas,
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        powerPreference: 'high-performance',
      });

      const root = new Container();
      const layers = [new Sprite(), new Sprite()];
      const textures = new Map();
      for (const sprite of layers) {
        sprite.anchor.set(0.5, 1);
        sprite.position.set(width / 2, height - 8);
        root.addChild(sprite);
      }
      app.stage.addChild(root);

      let currentWidth = width;
      let currentHeight = height;
      let destroyed = false;

      function fitSprite(sprite) {
        if (!sprite.texture?.width || !sprite.texture?.height) return;
        const scale = Math.min(currentWidth / sprite.texture.width, currentHeight / sprite.texture.height);
        sprite.scale.set(scale);
        sprite.position.set(currentWidth / 2, currentHeight - 8);
      }

      return {
        async preload(frames) {
          for (const url of Object.values(frames)) {
            if (!textures.has(url)) textures.set(url, await Assets.load(url));
          }
        },
        setFrame(layer, url) {
          if (destroyed) return;
          const texture = textures.get(url);
          if (!texture) throw new Error(`frame texture was not preloaded: ${url}`);
          layers[layer].texture = texture;
          fitSprite(layers[layer]);
        },
        setOpacity(layer, value) {
          if (!destroyed) layers[layer].alpha = value;
        },
        setTransform(value) {
          if (destroyed) return;
          root.scale.set(value.scaleX || 1, value.scaleY || 1);
          root.rotation = value.rotation || 0;
          root.position.set(value.offsetX || 0, value.offsetY || 0);
        },
        capture() {
          if (destroyed) throw new Error('renderer has been destroyed');
          return canvasBlob(canvas);
        },
        resize(nextWidth, nextHeight, dpr = 1) {
          if (destroyed) return;
          currentWidth = Math.max(1, nextWidth);
          currentHeight = Math.max(1, nextHeight);
          app.renderer.resolution = Math.min(Math.max(dpr, 1), 2);
          app.renderer.resize(currentWidth, currentHeight);
          for (const sprite of layers) fitSprite(sprite);
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          app.destroy(true, { children: true, texture: false, textureSource: false });
        },
      };
    },
  };
}
