// @vitest-environment jsdom
import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  GlideCanvas,
  Renderer,
  Viewport,
  useGlideCanvas,
  type GlideCanvasInstance,
  type GlideCanvasOptions,
  type GlideCanvasRef,
  type ViewportRef,
} from "../src/canvas-glide.ts";

// jsdom has no layout, no ResizeObserver, no 2D context and no createImageBitmap.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 });
globalThis.createImageBitmap = (async () => ({ width: 300, height: 300, close() {} })) as unknown as typeof createImageBitmap;

type FakeContext = { calls: string[] };
const contexts = new WeakMap<HTMLCanvasElement, FakeContext>();
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  if (!contexts.has(this)) {
    const calls: string[] = [];
    contexts.set(this, {
      calls,
      resetTransform: () => calls.push("reset"),
      clearRect: () => calls.push("clear"),
      setTransform: () => calls.push("transform"),
      drawImage: () => calls.push("draw"),
    } as FakeContext);
  }
  return contexts.get(this);
} as unknown as HTMLCanvasElement["getContext"];

const setDevicePixelRatio = (value: number) =>
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value });

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  setDevicePixelRatio(1);
});

async function render(node: ReactNode) {
  if (!root) {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  }
  await act(async () => root!.render(node));
}

/** Lets pending promises (image decoding) and one animation frame run. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }
}

afterEach(() => {
  root = undefined;
});

function Probe({ config, onReady }: { config: GlideCanvasOptions; onReady: (glide: GlideCanvasInstance) => void }) {
  onReady(useGlideCanvas(config));
  return null;
}

const rects = {
  getViewportRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
  getCanvasRect: () => ({ x: 0, y: 0, width: 400, height: 300 }),
};

test("a scale range in config.constraints keeps the default origin limit", async () => {
  let glide!: GlideCanvasInstance;
  await render(<Probe config={{ ...rects, constraints: { scale: { constraints: [1, 4] } } }} onReady={(g) => (glide = g)} />);

  glide.zoomTo(10);
  glide.panTo({ x: 5000, y: 5000 });

  assert.equal(glide.getScale(), 4);
  assert.deepEqual(glide.getOrigin(), { x: 400, y: 300 });
});

test("config.constraints.origin replaces the default origin limit", async () => {
  let glide!: GlideCanvasInstance;
  const origin = { constraints: { x: [0, 10], y: [0, 10] } as { x: [number, number]; y: [number, number] } };
  await render(<Probe config={{ ...rects, constraints: { origin } }} onReady={(g) => (glide = g)} />);

  glide.panTo({ x: 5000, y: 5000 });

  assert.deepEqual(glide.getOrigin(), { x: 10, y: 10 });
});

test("Viewport.getRect reads the element's position on every call", async () => {
  const viewport = createRef<ViewportRef>();
  await render(<Viewport ref={viewport} />);
  const element = viewport.current!.getElement()!;

  let left = 0;
  element.getBoundingClientRect = () => ({ x: left, y: 0, width: 100, height: 100 }) as DOMRect;
  assert.equal(viewport.current!.getRect()!.x, 0);

  left = 150;
  assert.equal(viewport.current!.getRect()!.x, 150);
});

test("wheelEnabled turned off after mount removes the wheel listener", async () => {
  let wheels = 0;
  const lib = { onWheel: () => wheels++ } as unknown as GlideCanvasInstance;
  const viewport = createRef<ViewportRef>();

  await render(<Viewport ref={viewport} lib={lib} />);
  viewport.current!.getElement()!.dispatchEvent(new WheelEvent("wheel"));
  await render(<Viewport ref={viewport} lib={lib} wheelEnabled={false} />);
  viewport.current!.getElement()!.dispatchEvent(new WheelEvent("wheel"));

  assert.equal(wheels, 1);
});

test("the canvas renderer clears the canvas when the image is removed", async () => {
  await render(<GlideCanvas image={new Blob(["x"], { type: "image/png" })} />);
  await settle();
  const calls = contexts.get(host!.querySelector("canvas")!)!.calls;
  assert.ok(calls.includes("draw"));

  calls.length = 0;
  await render(<GlideCanvas image={null} />);
  await settle();

  assert.ok(calls.includes("clear"));
  assert.ok(!calls.includes("draw"));
});

test("the canvas renderer resizes its backing store when devicePixelRatio changes", async () => {
  const glide = createRef<GlideCanvasRef>();
  await render(<GlideCanvas ref={glide} image={new Blob(["x"], { type: "image/png" })} />);
  await settle();
  const canvas = host!.querySelector("canvas")!;
  assert.equal(canvas.width, 1000);

  setDevicePixelRatio(2);
  await act(async () => glide.current!.zoomIn());
  await settle();

  assert.equal(canvas.width, 2000);
  assert.equal(canvas.height, 1400);
});

test("the image renderer shows an SVG through a data: URL", async () => {
  await render(
    <GlideCanvas renderer={Renderer.Image} image={new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], { type: "image/svg+xml" })} />,
  );
  await settle();

  assert.match(host!.querySelector("img")!.getAttribute("src") ?? "", /^data:image\/svg\+xml;base64,/);
});
