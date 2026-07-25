import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
  src: string | null;
  onUpload: (dataUrl: string) => void;
  onClear: () => void;
  className?: string;
}

export function ImageViewer({ src, onUpload, onClear, className }: ImageViewerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  const resetView = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setRotate(0);
    setBrightness(100);
    setContrast(100);
  }, []);

  useEffect(() => {
    resetView();
  }, [src, resetView]);

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  function handleFile(file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onUpload(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function onWheel(e: WheelEvent) {
    if (!src) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.min(8, Math.max(0.2, Number((s + delta).toFixed(2)))));
  }

  function onPointerDown(e: PointerEvent) {
    if (!src || e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    dragOrigin.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    setPan({
      x: dragOrigin.current.panX + (e.clientX - dragOrigin.current.x),
      y: dragOrigin.current.panY + (e.clientY - dragOrigin.current.y),
    });
  }

  function onPointerUp() {
    setDragging(false);
  }

  const filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale}) rotate(${rotate}deg)`;

  const stage = (
    <div
      ref={stageRef}
      className={cn(
        "relative flex-1 min-h-0 overflow-hidden bg-[#1a1a1a] select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {src ? (
        <img
          src={src}
          alt="Shipment reference"
          draggable={false}
          className="absolute left-1/2 top-1/2 max-w-none origin-center"
          style={{
            filter,
            transform: `translate(-50%, -50%) ${transform}`,
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50 p-6 text-center">
          Upload a WhatsApp bon photo for reference while typing.
          <br />
          Image is never cropped or sent to AI.
        </div>
      )}
    </div>
  );

  const controls = (
    <div className="shrink-0 space-y-2 border-t border-border bg-card p-3">
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          Upload
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!src} onClick={() => setRotate((r) => r + 90)}>
          Rotate
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!src} onClick={resetView}>
          Fit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!src}
          onClick={() => setFullscreen(true)}
        >
          Full
        </Button>
        {src && (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Brightness</Label>
          <input
            type="range"
            min={40}
            max={180}
            value={brightness}
            disabled={!src}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Contrast</Label>
          <input
            type="range"
            min={40}
            max={180}
            value={contrast}
            disabled={!src}
            onChange={(e) => setContrast(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Wheel zoom · drag pan · {Math.round(scale * 100)}%
      </p>
    </div>
  );

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <aside className={cn("flex h-full flex-col border-l border-border bg-card", className)}>
        <div className="shrink-0 border-b border-border px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reference image
          </p>
        </div>
        {stage}
        {controls}
      </aside>

      {fullscreen && src && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2 text-white">
            <span className="text-sm">Fullscreen preview — Esc to close</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setFullscreen(false)}>
              Close
            </Button>
          </div>
          <div
            className="relative flex-1 overflow-hidden cursor-grab"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <img
              src={src}
              alt="Fullscreen shipment"
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none origin-center"
              style={{
                filter,
                transform: `translate(-50%, -50%) ${transform}`,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
