"use client";

import React, { useMemo, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { DrawnLine } from "@/components/CandlestickChart";

export type DrawingMode = "none" | "horizontal" | "trend" | "rectangle" | "fibonacci" | "text";

interface DrawingOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<"Candlestick"> | null;
  drawingMode: DrawingMode;
  drawnLines: DrawnLine[];
  onCreateLine: (line: DrawnLine) => void;
  onUpdateLine: (id: string, updates: Partial<DrawnLine>) => void;
  onDeleteLine: (id: string) => void;
  onExitDrawing?: () => void;
}

interface ChartPoint {
  timeMs: number;
  price: number;
}

const HIT_TEST_PX = 5;

function isPointNearLine(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return false;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const dist = Math.hypot(p.x - projX, p.y - projY);
  return dist <= HIT_TEST_PX;
}

export function DrawingOverlay({
  chart,
  candleSeries,
  drawingMode,
  drawnLines,
  onCreateLine,
  onUpdateLine,
  onDeleteLine,
  onExitDrawing,
}: DrawingOverlayProps) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const draftStartRef = useRef<ChartPoint | null>(null);
  const draggingRef = useRef<{
    id: string;
    mode: "move" | "start" | "end";
    anchor?: ChartPoint;
  } | null>(null);

  const selectedLine = useMemo(
    () => drawnLines.find((line) => line.id === selectedLineId) ?? null,
    [drawnLines, selectedLineId]
  );

  const toChartPoint = (event: React.MouseEvent<HTMLDivElement>): ChartPoint | null => {
    if (!chart || !candleSeries) return null;
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const time = chart.timeScale().coordinateToTime(x);
    const price = candleSeries.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return {
      timeMs: (time as number) * 1000,
      price,
    };
  };

  const toScreenPoint = (timeMs: number, price: number): { x: number; y: number } | null => {
    if (!chart || !candleSeries) return null;
    const x = chart.timeScale().timeToCoordinate(Math.floor(timeMs / 1000) as Time);
    const y = candleSeries.priceToCoordinate(price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  const hitTestLine = (event: React.MouseEvent<HTMLDivElement>): DrawnLine | null => {
    if (!chart || !candleSeries) return null;
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    for (let i = drawnLines.length - 1; i >= 0; i -= 1) {
      const line = drawnLines[i];
      if (line.type === "horizontal") {
        const a = toScreenPoint(line.startTime, line.price);
        const b = toScreenPoint(line.endTime, line.price);
        if (a && b && isPointNearLine(a, b, mouse)) return line;
      } else if (line.type === "trend" || line.type === "rectangle" || line.type === "fibonacci") {
        const a = toScreenPoint(line.startTime, line.startPrice);
        const b = toScreenPoint(line.endTime, line.endPrice);
        if (a && b && isPointNearLine(a, b, mouse)) return line;
      } else if (line.type === "text") {
        const p = toScreenPoint(line.time, line.price);
        if (p && Math.hypot(p.x - mouse.x, p.y - mouse.y) <= HIT_TEST_PX + 3) return line;
      }
    }

    return null;
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const point = toChartPoint(event);
    if (!point) return;

    // 描画モード中は新規作成優先
    if (drawingMode !== "none") {
      if (drawingMode === "text") {
        const text = window.prompt("注釈テキストを入力してください");
        if (text && text.trim()) {
          onCreateLine({
            id: `line-${Date.now()}`,
            type: "text",
            time: point.timeMs,
            price: point.price,
            text: text.trim(),
            color: "#fbbf24",
          });
          onExitDrawing?.();
        }
        return;
      }
      draftStartRef.current = point;
      return;
    }

    // 編集モード（選択＆ドラッグ）
    const hit = hitTestLine(event);
    if (!hit) {
      setSelectedLineId(null);
      return;
    }

    setSelectedLineId(hit.id);
    draggingRef.current = {
      id: hit.id,
      mode: "move",
      anchor: point,
    };
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const point = toChartPoint(event);
    if (!point) return;

    const target = drawnLines.find((line) => line.id === draggingRef.current?.id);
    if (!target || !draggingRef.current.anchor) return;

    const diffPrice = point.price - draggingRef.current.anchor.price;
    const diffTime = point.timeMs - draggingRef.current.anchor.timeMs;
    draggingRef.current.anchor = point;

    if (target.type === "horizontal") {
      onUpdateLine(target.id, {
        price: target.price + diffPrice,
      });
      return;
    }

    if (target.type === "trend" || target.type === "rectangle" || target.type === "fibonacci") {
      onUpdateLine(target.id, {
        startPrice: target.startPrice + diffPrice,
        endPrice: target.endPrice + diffPrice,
        startTime: target.startTime + diffTime,
        endTime: target.endTime + diffTime,
      });
      return;
    }

    if (target.type === "text") {
      onUpdateLine(target.id, {
        time: target.time + diffTime,
        price: target.price + diffPrice,
      });
    }
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLDivElement>) => {
    // 新規作成完了
    if (drawingMode !== "none" && draftStartRef.current) {
      const end = toChartPoint(event);
      const start = draftStartRef.current;
      draftStartRef.current = null;
      if (!end) return;

      if (drawingMode === "horizontal") {
        onCreateLine({
          id: `line-${Date.now()}`,
          type: "horizontal",
          price: end.price,
          startTime: start.timeMs,
          endTime: end.timeMs,
          color: "#fbbf24",
          lineWidth: 2,
        });
      } else if (drawingMode === "trend") {
        onCreateLine({
          id: `line-${Date.now()}`,
          type: "trend",
          startTime: start.timeMs,
          endTime: end.timeMs,
          startPrice: start.price,
          endPrice: end.price,
          color: "#fbbf24",
          lineWidth: 2,
        });
      } else if (drawingMode === "rectangle") {
        onCreateLine({
          id: `line-${Date.now()}`,
          type: "rectangle",
          startTime: start.timeMs,
          endTime: end.timeMs,
          startPrice: start.price,
          endPrice: end.price,
          color: "#60a5fa",
          lineWidth: 2,
        });
      } else if (drawingMode === "fibonacci") {
        onCreateLine({
          id: `line-${Date.now()}`,
          type: "fibonacci",
          startTime: start.timeMs,
          endTime: end.timeMs,
          startPrice: start.price,
          endPrice: end.price,
          color: "#a78bfa",
          lineWidth: 2,
        });
      }
      onExitDrawing?.();
      return;
    }

    draggingRef.current = null;
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedLine) return;
    event.preventDefault();
    if (window.confirm("選択中のラインを削除しますか？")) {
      onDeleteLine(selectedLine.id);
      setSelectedLineId(null);
    }
  };

  const handleDoubleClick = () => {
    if (!selectedLine) return;
    if (selectedLine.type === "horizontal") {
      const input = window.prompt("価格を入力してください", String(selectedLine.price));
      const parsed = input ? Number(input) : Number.NaN;
      if (Number.isFinite(parsed)) {
        onUpdateLine(selectedLine.id, { price: parsed });
      }
      return;
    }
    if (selectedLine.type === "text") {
      const input = window.prompt("テキストを編集してください", selectedLine.text);
      if (input && input.trim()) {
        onUpdateLine(selectedLine.id, { text: input.trim() });
      }
    }
  };

  const isActive = drawingMode !== "none" || selectedLineId !== null;

  return (
    <div
      className="absolute inset-0"
      style={{
        pointerEvents: isActive ? "auto" : "none",
        cursor: drawingMode === "none" ? "default" : "crosshair",
        zIndex: 15,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    />
  );
}

export default DrawingOverlay;
