import { z } from "zod";

const DrawnLineBaseSchema = z.object({
  id: z.string().min(1),
  color: z.string().optional(),
  lineWidth: z.number().int().min(1).max(8).optional(),
});

const HorizontalLineSchema = DrawnLineBaseSchema.extend({
  type: z.literal("horizontal"),
  price: z.number(),
  startTime: z.number().int(),
  endTime: z.number().int(),
});

const TrendLineSchema = DrawnLineBaseSchema.extend({
  type: z.literal("trend"),
  startTime: z.number().int(),
  endTime: z.number().int(),
  startPrice: z.number(),
  endPrice: z.number(),
});

const RectangleLineSchema = DrawnLineBaseSchema.extend({
  type: z.literal("rectangle"),
  startTime: z.number().int(),
  endTime: z.number().int(),
  startPrice: z.number(),
  endPrice: z.number(),
});

const FibonacciLineSchema = DrawnLineBaseSchema.extend({
  type: z.literal("fibonacci"),
  startTime: z.number().int(),
  endTime: z.number().int(),
  startPrice: z.number(),
  endPrice: z.number(),
});

const TextLineSchema = DrawnLineBaseSchema.extend({
  type: z.literal("text"),
  time: z.number().int(),
  price: z.number(),
  text: z.string().min(1).max(200),
});

export const DrawnLineSchema = z.discriminatedUnion("type", [
  HorizontalLineSchema,
  TrendLineSchema,
  RectangleLineSchema,
  FibonacciLineSchema,
  TextLineSchema,
]);

export const ChartDrawingSyncRequestSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  lines: z.array(DrawnLineSchema),
});

export const ChartDrawingResponseSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  lines: z.array(DrawnLineSchema),
  updatedAt: z.string().optional(),
});

export type DrawnLinePayload = z.infer<typeof DrawnLineSchema>;
export type ChartDrawingResponse = z.infer<typeof ChartDrawingResponseSchema>;
