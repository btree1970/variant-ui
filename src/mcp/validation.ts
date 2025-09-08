import { z } from 'zod';

export const CreateVariationSchema = z.object({
  baseRef: z.string().default('HEAD'),
  description: z.string().min(1).max(100),
});

export const ListVariationsSchema = z.object({});

export const RemoveVariationSchema = z.object({
  variantId: z.string().regex(/^\d{3}$/, 'Variant ID must be a 3-digit number'),
});

export const ApplyPatchSchema = z.object({
  variantId: z.string().regex(/^\d{3}$/, 'Variant ID must be a 3-digit number'),
  patch: z.string().min(1),
});

export const CheckStatusSchema = z.object({});

export type CreateVariationInput = z.infer<typeof CreateVariationSchema>;
export type ListVariationsInput = z.infer<typeof ListVariationsSchema>;
export type RemoveVariationInput = z.infer<typeof RemoveVariationSchema>;
export type ApplyPatchInput = z.infer<typeof ApplyPatchSchema>;
export type CheckStatusInput = z.infer<typeof CheckStatusSchema>;
