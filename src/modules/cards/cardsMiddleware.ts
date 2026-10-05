import type { NextFunction, Request, Response } from "express";
import { db } from "../../prisma/db";
import type { AuthenticatedRequest } from "../../types/server";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "../errors/AppError";
import {
	validateCardId,
	validateListId,
	validateMoveCardPayload,
} from "./cardsValidator";
import type { List } from "../lists/listsService";

type Membership = Awaited<
	ReturnType<typeof db.orm.public.Membership.where>
> extends { first: () => infer Result }
	? Awaited<Result>
	: never;

function ensureRequestLocals(req: Request): void {
	req.locals ??= {};
}

function getAuthenticatedUserId(req: Request): string | undefined {
	return (req as unknown as AuthenticatedRequest).user?.userId;
}

async function getListForCardContext(req: Request): Promise<List | undefined> {
	if (req.locals.list) {
		return req.locals.list;
	}

	const listId =
		typeof req.params.listId === "string"
			? req.params.listId
			: typeof req.params.id === "string" && req.path.endsWith("/cards")
				? req.params.id
				: undefined;

	if (!listId) {
		return undefined;
	}

	const { id } = validateListId(listId);
	const list = await db.orm.public.List.where({ id }).first();
	if (!list) {
		throw NotFoundError("List not found");
	}

	req.locals.list = list;
	return list;
}

async function requireBoardEditor(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		ensureRequestLocals(req);
		const list = await getListForCardContext(req);
		const boardId = req.locals.card?.list.boardId ?? list?.boardId;
		const userId = getAuthenticatedUserId(req);

		if (!boardId || !userId) {
			throw ForbiddenError("Only editors can modify cards");
		}

		const membership = await db.orm.public.Membership.where({
			boardId,
			userId,
		}).first();

		if (!membership || !["EDITOR", "OWNER"].includes(membership.role)) {
			throw ForbiddenError("Only editors can modify cards");
		}

		req.locals.membership = membership;
		next();
	} catch (error) {
		next(error);
	}
}

async function validateCardExists(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		ensureRequestLocals(req);
		const { id } = validateCardId(req.params.id);
		const card = await db.orm.public.Card.where({ id }).first();

		if (!card) {
			throw NotFoundError("Card not found");
		}

		const list = await db.orm.public.List.where({ id: card.listId }).first();
		if (!list) {
			throw NotFoundError("Card not found");
		}

		const requestedListId =
			typeof req.params.listId === "string" ? req.params.listId : undefined;
		if (requestedListId && list.id !== validateListId(requestedListId).id) {
			throw NotFoundError("Card not found in this list");
		}

		const cardWithList: Omit<typeof card, "list"> & { list: List } = {
			...card,
			list,
		};
		req.locals.card = cardWithList;
		next();
	} catch (error) {
		next(error);
	}
}

async function validateMovePayload(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		ensureRequestLocals(req);
		const payload = validateMoveCardPayload(req.body);
		const card = req.locals.card;

		if (!card) {
			throw NotFoundError("Card not found");
		}

		if (payload.version < card.version) {
			throw ConflictError(
				`Card has been modified. Current version is ${card.version}.`,
			);
		}

		next();
	} catch (error) {
		next(error);
	}
}

async function validateTargetList(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	try {
		ensureRequestLocals(req);
		const card = req.locals.card;
		if (!card) {
			throw NotFoundError("Card not found");
		}

		const { toListId } = validateMoveCardPayload(req.body);
		const targetList = await db.orm.public.List.where({ id: toListId }).first();

		if (!targetList || targetList.boardId !== card.list.boardId) {
			throw NotFoundError("Target list not found");
		}

		req.locals.targetList = targetList;
		next();
	} catch (error) {
		next(error);
	}
}

export {
	requireBoardEditor,
	validateCardExists,
	validateMovePayload,
	validateTargetList,
};
