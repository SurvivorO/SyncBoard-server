import type { NextFunction, Request, Response } from "express";
import {
	ForbiddenError,
	NotFoundError,
} from "../errors/AppError";
import type { AuthenticatedRequest } from "../../types/server";
import { getUserBoardRole } from "./boardService";
import { hasPermission } from "./membershipService";
import type { MemberRole } from "./boardTypes";

declare global {
	namespace Express {
		interface Request {
			boardId?: string;
			userRole?: MemberRole | null;
		}
	}
}

async function requireBoardMember(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		const idParam = req.params.id ?? req.params.boardId;
		const boardId = typeof idParam === "string" ? idParam : undefined;
		const userId = (req as unknown as AuthenticatedRequest).user?.userId;

		if (!boardId || !userId) {
			throw NotFoundError("Board not found");
		}

		const role = await getUserBoardRole(boardId, userId);
		if (!role) {
			throw ForbiddenError("You do not have access to this board");
		}

		req.boardId = boardId;
		req.userRole = role;
		next();
	} catch (error) {
		next(error);
	}
}

async function requireBoardWrite(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		if (!hasPermission(req.userRole ?? null, "write")) {
			throw ForbiddenError(
				"You do not have permission to edit this board. Only editors and owners can make changes.",
			);
		}

		next();
	} catch (error) {
		next(error);
	}
}

async function requireBoardOwner(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		if (!hasPermission(req.userRole ?? null, "admin")) {
			throw ForbiddenError(
				"You do not have permission to perform this action. Only the owner can.",
			);
		}

		next();
	} catch (error) {
		next(error);
	}
}

export {
	requireBoardMember,
	requireBoardWrite,
	requireBoardOwner,
};
