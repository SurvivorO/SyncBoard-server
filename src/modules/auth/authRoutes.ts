import { Router, type Request } from "express";
import { db } from "../../prisma/db";
import { ConflictError, UnauthorizedError } from "../errors/AppError";
import { authMiddleware } from "./authMiddleware";
import {
	comparePassword,
	createRefreshToken,
	generateAccessToken,
	hashPassword,
	rotateRefreshToken,
	verifyRefreshToken,
} from "./authService";
import {
	loginSchema,
	refreshSchema,
	registerSchema,
} from "./authValidator";
import type { AuthenticatedRequest } from "../../types/server";

const authRoutes = Router();

authRoutes.post("/register", async (req, res) => {
	const input = registerSchema.parse(req.body);
	const existingUser = await db.orm.public.User.where({
		email: input.email,
	}).first();

	if (existingUser) {
		throw ConflictError("An account with this email already exists");
	}

	const user = await db.orm.public.User.create({
		email: input.email,
		name: input.name ?? null,
		passwordHash: await hashPassword(input.password),
	});

	const accessToken = generateAccessToken(user.id, user.email);
	const refreshToken = await createRefreshToken(user.id);

	res.status(201).json({
		accessToken,
		refreshToken,
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
		},
	});
});

authRoutes.post("/login", async (req, res) => {
	const input = loginSchema.parse(req.body);
	const user = await db.orm.public.User.where({ email: input.email }).first();

	if (!user || !(await comparePassword(input.password, user.passwordHash))) {
		throw UnauthorizedError("Invalid email or password");
	}

	await db.orm.public.RefreshToken.where({ userId: user.id }).delete();

	const accessToken = generateAccessToken(user.id, user.email);
	const refreshToken = await createRefreshToken(user.id);

	res.json({
		accessToken,
		refreshToken,
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
		},
	});
});

authRoutes.post("/refresh", async (req, res) => {
	const { refreshToken } = refreshSchema.parse(req.body);
	const { userId, tokenId } = await verifyRefreshToken(refreshToken);
	const newRefreshToken = await rotateRefreshToken(tokenId, userId);
	const user = await db.orm.public.User.where({ id: userId }).first();

	if (!user) {
		throw UnauthorizedError("User no longer exists");
	}

	res.json({
		accessToken: generateAccessToken(user.id, user.email),
		refreshToken: newRefreshToken,
	});
});

authRoutes.post(
	"/logout",
	authMiddleware,
	async (req: Request, res) => {
		const { userId } = (req as unknown as AuthenticatedRequest).user;
		await db.orm.public.RefreshToken.where({ userId }).delete();
		res.json({ message: "Logged out" });
	}
);

export { authRoutes };
export default authRoutes;