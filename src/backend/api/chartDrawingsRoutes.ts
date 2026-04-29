import type { Request, Response } from "express";
import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { requireAuth } from "../../middleware/authMiddleware";
import { getPrismaClient } from "../../infrastructure/prismaClient";
import {
  ChartDrawingQuerySchema,
  ChartDrawingResponseSchema,
  ChartDrawingSyncRequestSchema,
} from "../../schemas/api/chartDrawing";

const router = Router();
const prisma = getPrismaClient();

interface ChartDrawingRow {
  symbol: string;
  timeframe: string;
  lines: Prisma.JsonValue;
  updatedAt: Date;
}

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const parsed = ChartDrawingQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.format(),
    });
  }

  try {
    const userId = req.user!.userId;
    const { symbol, timeframe } = parsed.data;

    const rows = await prisma.$queryRaw<ChartDrawingRow[]>`
      SELECT "symbol", "timeframe", "lines", "updatedAt"
      FROM "ChartDrawing"
      WHERE "userId" = ${userId}::uuid
        AND "symbol" = ${symbol}
        AND "timeframe" = ${timeframe}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          symbol,
          timeframe,
          lines: [],
        },
      });
    }

    const row = rows[0];
    const data = ChartDrawingResponseSchema.parse({
      symbol: row.symbol,
      timeframe: row.timeframe,
      lines: row.lines,
      updatedAt: row.updatedAt.toISOString(),
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[ChartDrawingsRoutes] 取得エラー:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "描画データの取得に失敗しました",
    });
  }
});

router.put("/sync", requireAuth, async (req: Request, res: Response) => {
  const parsed = ChartDrawingSyncRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.format(),
    });
  }

  try {
    const userId = req.user!.userId;
    const { symbol, timeframe, lines } = parsed.data;
    const linesJson = JSON.stringify(lines);

    await prisma.$executeRaw`
      INSERT INTO "ChartDrawing" ("id", "userId", "symbol", "timeframe", "lines", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${userId}::uuid, ${symbol}, ${timeframe}, ${linesJson}::jsonb, now(), now())
      ON CONFLICT ("userId", "symbol", "timeframe")
      DO UPDATE SET
        "lines" = EXCLUDED."lines",
        "updatedAt" = now()
    `;

    const data = ChartDrawingResponseSchema.parse({
      symbol,
      timeframe,
      lines,
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[ChartDrawingsRoutes] 同期エラー:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "描画データの保存に失敗しました",
    });
  }
});

export default router;
