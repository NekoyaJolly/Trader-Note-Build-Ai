"use client";

/**
 * ドラッグ可能な発注パネルオーバーレイ (PC チャート上)。
 *
 * 責務: チャートに重ねる compact 版 OrderPanel を、専用ハンドルのドラッグで任意位置へ
 * 移動できるようにする薄いラッパー。位置は localStorage に保存し、チャートコンテナ内に
 * クランプする。発注ロジック自体 (OrderPanel) には一切手を加えない。
 *
 * なぜ新規ファイルか (AGENTS.md §5.3): 「ドラッグ状態管理 + 位置永続化 + 境界クランプ」という
 * まとまった UI 関心事であり、すでに肥大化している RealtimeChart に直書きすると見通しが
 * 悪化するため単一責務コンポーネントに分離する。削除条件: ドラッグ式オーバーレイをやめる場合。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { OrderPanel } from "@/components/chart/OrderPanel";

interface DraggableOrderPanelProps {
	symbol: string;
	disabled?: boolean;
	disabledReason?: string;
	onOrderPlaced?: () => void;
}

// 位置はオフセット親 (チャートの relative コンテナ) 基準の { left, top } px。
const PositionSchema = z.object({ left: z.number(), top: z.number() });
type Position = z.infer<typeof PositionSchema>;

const POSITION_STORAGE_KEY = "chart-order-panel-position";
const EDGE_MARGIN = 8; // コンテナ端からの最小余白 px

/**
 * 希望位置をコンテナ内に収める純粋なクランプ関数 (境界値ロジックをテスト可能にするため分離)。
 * left/top は [margin, コンテナ寸 - パネル寸 - margin] にクランプする。
 * パネルがコンテナより大きい等で上限が下限を下回る場合は margin に張り付かせる。
 */
export function clampOverlayPosition(
	desired: { left: number; top: number },
	bounds: { containerWidth: number; containerHeight: number; panelWidth: number; panelHeight: number },
	margin: number,
): Position {
	const maxLeft = Math.max(margin, bounds.containerWidth - bounds.panelWidth - margin);
	const maxTop = Math.max(margin, bounds.containerHeight - bounds.panelHeight - margin);
	return {
		left: Math.min(Math.max(margin, desired.left), maxLeft),
		top: Math.min(Math.max(margin, desired.top), maxTop),
	};
}

/** localStorage から保存位置を復元する。壊れた値は null にフォールバックする。 */
function loadPersistedPosition(): Position | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
		if (!raw) return null;
		const parsed = PositionSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function DraggableOrderPanel({ symbol, disabled, disabledReason, onOrderPlaced }: DraggableOrderPanelProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<Position | null>(null);
	// ドラッグ開始時のポインタ座標とパネル位置を記録する基準値
	const dragState = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

	// 親 (offsetParent) の内側に収まるよう left/top をクランプする
	const clampToParent = useCallback((left: number, top: number): Position => {
		const el = panelRef.current;
		const parent = el?.offsetParent as HTMLElement | null;
		if (!el || !parent) return { left, top };
		return clampOverlayPosition(
			{ left, top },
			{
				containerWidth: parent.clientWidth,
				containerHeight: parent.clientHeight,
				panelWidth: el.offsetWidth,
				panelHeight: el.offsetHeight,
			},
			EDGE_MARGIN,
		);
	}, []);

	// 初期位置: 保存値があれば現在のコンテナにクランプして復元、なければ従来どおり右上に置く。
	// パネルの実寸が必要なのでマウント後 (offsetParent / offsetWidth 確定後) に 1 回実行する。
	// setState はマイクロタスクに逃がして effect 本体での同期 setState (cascading renders) を避ける
	// (AppShell と同じ React Compiler 対策パターン)。
	// cancelled フラグ: StrictMode の再マウント等でアンマウント直後にマイクロタスクが走っても
	// setState しないようにする (アンマウント済みコンポーネントへの更新を防ぐ)。
	useEffect(() => {
		let cancelled = false;
		queueMicrotask(() => {
			if (cancelled) return;
			const el = panelRef.current;
			const parent = el?.offsetParent as HTMLElement | null;
			if (!el || !parent) return;
			const persisted = loadPersistedPosition();
			if (persisted) {
				setPosition(clampToParent(persisted.left, persisted.top));
			} else {
				const left = Math.max(EDGE_MARGIN, parent.clientWidth - el.offsetWidth - EDGE_MARGIN);
				setPosition({ left, top: EDGE_MARGIN });
			}
		});
		return () => {
			cancelled = true;
		};
	}, [clampToParent]);

	const persist = useCallback((pos: Position) => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
		} catch {
			// localStorage 不可 (容量超過 / プライベートモード) は無視
		}
	}, []);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!position) return;
			e.preventDefault();
			e.currentTarget.setPointerCapture(e.pointerId);
			dragState.current = {
				startX: e.clientX,
				startY: e.clientY,
				startLeft: position.left,
				startTop: position.top,
			};
		},
		[position],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragState.current;
			if (!drag) return;
			const nextLeft = drag.startLeft + (e.clientX - drag.startX);
			const nextTop = drag.startTop + (e.clientY - drag.startY);
			setPosition(clampToParent(nextLeft, nextTop));
		},
		[clampToParent],
	);

	const handlePointerUp = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!dragState.current) return;
			dragState.current = null;
			// pointercancel / OS ジェスチャでキャプチャが既に失われていると releasePointerCapture が
			// 例外を投げることがあるため、保持確認 + try/catch でドラッグ状態のスタックを防ぐ。
			try {
				if (e.currentTarget.hasPointerCapture(e.pointerId)) {
					e.currentTarget.releasePointerCapture(e.pointerId);
				}
			} catch {
				// キャプチャ喪失時の例外は無視 (状態は上で既にリセット済み)
			}
			// ドラッグ確定位置を保存する
			setPosition((prev) => {
				if (prev) persist(prev);
				return prev;
			});
		},
		[persist],
	);

	return (
		<div
			ref={panelRef}
			className="hidden md:block absolute z-20 w-48"
			// 位置未確定 (初回計測前) は右上に置きつつ非表示にし、左上への一瞬のチラつきを防ぐ。
			style={
				position
					? { left: position.left, top: position.top }
					: { top: EDGE_MARGIN, right: EDGE_MARGIN, visibility: "hidden" }
			}
		>
			{/* ドラッグハンドル: BUY/SELL ボタンやロット入力と干渉しないよう、専用バーをつまんで動かす */}
			<div
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
				className="flex items-center justify-center gap-1 cursor-move select-none touch-none rounded-t-lg border border-b-0 border-gray-600 bg-gray-700/90 py-0.5 text-[10px] text-gray-300 backdrop-blur-sm"
				role="button"
				// ドラッグ操作のハンドル。キーボードでも到達できるようフォーカス可能にする (a11y)
				tabIndex={0}
				aria-label="発注パネルを移動"
				title="ドラッグで移動"
			>
				<span aria-hidden="true">⋮⋮</span>
				<span>発注</span>
			</div>
			<OrderPanel
				symbol={symbol}
				compact
				disabled={disabled}
				disabledReason={disabledReason}
				onOrderPlaced={onOrderPlaced}
			/>
		</div>
	);
}

export default DraggableOrderPanel;
