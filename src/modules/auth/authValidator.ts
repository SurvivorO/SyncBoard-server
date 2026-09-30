import { z } from "zod";

const registerSchema = z.object({
	email: z.string().trim().email(),
	password: z.string().min(8),
	name: z.string().trim().optional(),
});

const loginSchema = z.object({
	email: z.string().trim().email(),
	password: z.string(),
});

const refreshSchema = z.object({
	refreshToken: z.string().min(1),
});

type RegisterRequest = z.infer<typeof registerSchema>;
type LoginRequest = z.infer<typeof loginSchema>;
type RefreshRequest = z.infer<typeof refreshSchema>;

export {
	registerSchema,
	loginSchema,
	refreshSchema,
	type RegisterRequest,
	type LoginRequest,
	type RefreshRequest,
};