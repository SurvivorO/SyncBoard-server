import { z } from "zod";

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    CORS_ORIGIN: z.string().default('https://localhost:5173'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_TOKEN: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
});

export const env = envSchema.parse(process.env);