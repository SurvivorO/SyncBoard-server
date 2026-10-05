import type { NextFunction, Request, Response } from "express";
import { db } from "../../prisma/db";
import type { AuthenticatedRequest } from "../../types/server";
import {
	ForbiddenError,
	NotFoundError,
} from "../errors/AppError";
import type { List } from "./listsService";
import { validateBoardId, validateListId } from "./listsValidator";

type Membership = Awaited<
	ReturnType<typeof db.orm.public.Membership.where>
> extends { first: () => infer Result }
	? Awaited<Result>
	: never;

declare global {
	namespace Express {
		interface Request {
			boardId?: string;
			locals: {
				list?: List;
				membership?: NonNullable<Membership>;
			};
		}
	}
}

function getAuthenticatedUserId(req: Request): string | undefined {
	return (req as unknown as AuthenticatedRequest).user?.userId;
}

function ensureRequestLocals(req: Request): void {
	req.locals ??= {};
}

function getBoardId(req: Request): string | undefined {
	if (req.boardId) {
		return req.boardId;
	}

	const boardIdParam = req.params.boardId ?? req.params.board;
	if (typeof boardIdParam === "string") {
		return boardIdParam;
	}

	if (
		typeof req.params.id === "string" &&
		req.baseUrl === "/boards" &&
		req.path.endsWith("/lists")
	) {
		return req.params.id;
	}

	return req.locals.list?.boardId;
}

async function loadListForBoardContext(req: Request): Promise<void> {
	if (getBoardId(req) || typeof req.params.id !== "string") {
		return;
	}

	const { id: listId } = validateListId(req.params.id);
	const list = await db.orm.public.List.where({ id: listId }).first();
	if (!list) {
		throw NotFoundError("List not found");
	}

	req.locals.list = list;
	req.boardId = list.boardId;
}

async function requireBoardEditor(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		ensureRequestLocals(req);
		await loadListForBoardContext(req);
		const userId = getAuthenticatedUserId(req);
		const boardId = getBoardId(req);

		if (!userId || !boardId) {
			throw ForbiddenError("Only editors can modify lists");
		}

		const { id } = validateBoardId(boardId);
		const membership = await db.orm.public.Membership.where({
			boardId: id,
			userId,
		}).first();

		if (!membership || !["EDITOR", "OWNER"].includes(membership.role)) {
			throw ForbiddenError("Only editors can modify lists");
		}

		req.boardId = id;
		req.locals.membership = membership;
		next();
	} catch (error) {
		next(error);
	}
}

async function validateListExists(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		ensureRequestLocals(req);
		const { id: listId } = validateListId(req.params.id);
		const list = await db.orm.public.List.where({ id: listId }).first();
		const boardId = getBoardId(req);

		if (!list || (boardId && list.boardId !== boardId)) {
			throw NotFoundError("List not found");
		}

		req.locals.list = list;
		if (!req.boardId) {
			req.boardId = list.boardId;
		}
		next();
	} catch (error) {
		next(error);
	}
}

export {
	requireBoardEditor,
	validateListExists,
};
