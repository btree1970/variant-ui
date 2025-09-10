import { z } from 'zod';

export const CreateVariationSchema = z.object({
  baseRef: z.string().default('HEAD'),
  description: z.string().min(1).max(100),
});

export const ListVariationsSchema = z.object({});

export const RemoveVariationSchema = z.object({
  variantId: z.string().regex(/^\d{3}$/, 'Variant ID must be a 3-digit number'),
});

export const CheckStatusSchema = z.object({});

export const StartPreviewSchema = z.object({
  variantId: z.string().regex(/^\d{3}$/, 'Variant ID must be a 3-digit number'),
});

export const StopPreviewSchema = z.object({
  variantId: z.string().regex(/^\d{3}$/, 'Variant ID must be a 3-digit number'),
});

export const PreviewStatusSchema = z.object({});

export type CreateVariationInput = z.infer<typeof CreateVariationSchema>;
export type ListVariationsInput = z.infer<typeof ListVariationsSchema>;
export type RemoveVariationInput = z.infer<typeof RemoveVariationSchema>;
export type CheckStatusInput = z.infer<typeof CheckStatusSchema>;
export type StartPreviewInput = z.infer<typeof StartPreviewSchema>;
export type StopPreviewInput = z.infer<typeof StopPreviewSchema>;
export type PreviewStatusInput = z.infer<typeof PreviewStatusSchema>;
