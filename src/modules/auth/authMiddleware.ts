import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../errors/AppError";
import { verifyAccessToken } from "./authService";
import type { AuthenticatedRequest } from "../../types/server";

function authMiddleware(
	req: Request,
	_res: Response,
	next: NextFunction
): void {
	const authorization = req.get("authorization");
	const match = authorization?.match(/^Bearer\s+(.+)$/i);

	if (!match) {
		next(UnauthorizedError("Invalid token"));
		return;
	}

	try {
		const user = verifyAccessToken(match[1]);
		(req as unknown as AuthenticatedRequest).user = user;
		next();
	} catch {
		next(UnauthorizedError("Invalid token"));
	}
}

export { authMiddleware };
export default authMiddleware;