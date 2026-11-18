import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Renderer, RendererConfig, RendererRef } from "./base.tsx";
import type { ViewportRef } from "../Viewport.tsx";
import { useAsyncMemo } from "../util/asyncMemo.ts";
import { createImageBitmapSafe } from "../util/image.ts";
import { useIdealScale } from "../util/useIdealScale.ts";
import { type Transform } from "canvas-glide";

export type CanvasRendererProps = RendererConfig<typeof Renderer.Canvas>;

const defaultCanvasStyles: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  height: "100%",
  width: "100%",
};

export function Canvas({ viewportRef, ref, afterDraw, image, lib, container, content }: CanvasRendererProps) {
  const { style: containerStyle, ref: _unusedContainer, ...containerRest } = container ?? {};
  const { style: contentStyle, ref: _unusedContent, ...contentRest } = content ?? {};

  const canvasStyles = {
    ...defaultCanvasStyles,
    ...containerStyle,
    ...contentStyle,
  };

  const imageBitmap = useAsyncMemo(
    () => createImageBitmapSafe(image),
    [image],
    (bitmap) => bitmap?.close(),
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [offscreenCanvas] = useState(() => document.createElement("canvas"));
  const canvasContext = useRef<CanvasRenderingContext2D | null>(null);

  function applySmoothing(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  useEffect(() => {
    if (canvasContext.current) return;
    canvasContext.current = canvasRef?.current?.getContext("2d") || null;
    if (canvasContext.current) applySmoothing(canvasContext.current);
  }, []);

  const { idealScale, updateIdealScale, fitWhenSized, getImageRect } = useIdealScale(viewportRef, lib, () => ({
    width: offscreenCanvas.width,
    height: offscreenCanvas.height,
  }));

  /* oxlint-disable react-hooks/exhaustive-deps -- runs only when the image changes */
  useEffect(() => {
    if (!imageBitmap) {
      offscreenCanvas.width = 0;
      offscreenCanvas.height = 0;
      clear();
      return;
    }

    updateOffscreenCanvas(imageBitmap);
    handleViewportResize(viewportRef?.current);
    fitWhenSized();
    updateIdealScale();

    // fit() only emits when the transform actually changes, so draw explicitly too.
    draw(lib?.stateService.getTransform());
  }, [imageBitmap]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvasContext.current;
    if (!canvas || !ctx) return;

    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw(transform?: Transform) {
    // The offscreen canvas is filled in an effect after paint; a ResizeObserver or frame callback can draw before it.
    if (!canvasRef.current || !transform || !imageBitmap || !offscreenCanvas.width) return;

    const canvas = canvasRef.current;
    const scale = transform.scale;
    const originX = transform.origin.x;
    const originY = transform.origin.y;

    const ctx = canvasContext.current;
    if (!ctx) return;

    // A devicePixelRatio change (window moved to another screen) does not resize the viewport, so check on every draw.
    const viewport = viewportRef?.current;
    if (viewport && (canvas.width !== Math.floor(viewport.getWidth()) || canvas.height !== Math.floor(viewport.getHeight()))) {
      updateSize(viewport.getWidth(), viewport.getHeight());
    }

    const dpr = window.devicePixelRatio || 1;

    clear();

    const s = scale * dpr;
    ctx.setTransform(s, 0, 0, s, -originX * s, -originY * s);

    ctx.drawImage(
      offscreenCanvas,
      0,
      0,
      offscreenCanvas.width * idealScale.current,
      offscreenCanvas.height * idealScale.current,
    );

    afterDraw?.(transform, externalRef);
  }

  function redraw() {
    draw(lib?.stateService.getTransform());
  }

  function updateOffscreenCanvas(imageBitmap: ImageBitmap) {
    offscreenCanvas.width = imageBitmap.width;
    offscreenCanvas.height = imageBitmap.height;
    const ctx = offscreenCanvas.getContext("2d");
    ctx?.drawImage(imageBitmap, 0, 0);
  }

  function updateSize(width: number, height: number) {
    if (!canvasRef.current) return;
    canvasRef.current.width = width;
    canvasRef.current.height = height;

    if (canvasContext.current) applySmoothing(canvasContext.current);

    updateIdealScale();
  }

  function handleViewportResize(viewport?: ViewportRef | null) {
    if (!viewport) return;

    updateSize(viewport.getWidth(), viewport.getHeight());
    redraw();
  }

  const externalRef: RendererRef[typeof Renderer.Canvas] = {
    getContainerRef: () => canvasRef.current,
    getContentRef: () => canvasRef.current,
    draw,
    handleViewportResize,
    getImageRect: () => getImageRect(canvasRef.current),
  };

  useImperativeHandle(ref, () => externalRef);

  return <canvas style={canvasStyles} ref={canvasRef} {...containerRest} {...contentRest} />;
}

export default Canvas;
