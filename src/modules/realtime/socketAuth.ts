import type { ExtendedError } from "socket.io";
import { verifyAccessToken } from "../auth/authService.js";
import type { AppSocket } from "./socketTypes.js";

export function socketAuthMiddleware(
	socket: AppSocket,
	next: (err?: ExtendedError) => void
): void {
	const rawToken =
		socket.handshake.auth?.token ??
		socket.handshake.headers?.authorization;

	if (!rawToken || typeof rawToken !== "string") {
		return next(new Error("Authentication error: Token required"));
	}

	const token = rawToken.startsWith("Bearer ")
		? rawToken.slice(7).trim()
		: rawToken.trim();

	if (!token) {
		return next(new Error("Authentication error: Token required"));
	}

	try {
		const payload = verifyAccessToken(token);
		socket.data.userId = payload.userId;
		socket.data.email = payload.email;
		next();
	} catch {
		next(new Error("Authentication error: Invalid or expired token"));
	}
}

