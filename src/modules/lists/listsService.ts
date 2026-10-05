import fractionalIndex from "fractional-index";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract";
import {
	BadRequestError,
	ConflictError,
	NotFoundError,
} from "../errors/AppError";

type List = Pick<
	Models.public_List,
	"boardId" | "createdAt" | "id" | "position" | "title" | "updatedAt"
>;

interface ListUpdates {
	title?: string;
}

function getDatabaseErrorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return undefined;
	}

	const code = error.code;
	return typeof code === "string" ? code : undefined;
}

function isConstraintError(error: unknown, code: string): boolean {
	return (
		getDatabaseErrorCode(error) === code ||
		(error instanceof Error && error.message.includes(code))
	);
}

function calculateInitialPosition(
	afterPosition: string | null,
	beforePosition: string | null,
): string {
	return fractionalIndex(afterPosition, beforePosition);
}

async function createList(boardId: string, title: string): Promise<List> {
	const lastList = await db.orm.public.List
		.where({ boardId })
		.orderBy((list) => list.position.desc())
		.first();
	const position = calculateInitialPosition(lastList?.position ?? null, null);

	try {
		return await db.orm.public.List.create({
			boardId,
			title,
			position,
		});
	} catch (error) {
		if (isConstraintError(error, "23505") || isConstraintError(error, "P2002")) {
			throw ConflictError("A list position conflict occurred. Please try again.");
		}
		if (isConstraintError(error, "23503") || isConstraintError(error, "P2003")) {
			throw NotFoundError("Board not found");
		}
		throw error;
	}
}

async function updateList(
	listId: string,
	updates: ListUpdates,
): Promise<List> {
	if (Object.keys(updates).length === 0) {
		throw BadRequestError("No fields to update");
	}

	try {
		const list = await db.orm.public.List.where({ id: listId }).update(updates);
		if (!list) {
			throw NotFoundError("List not found");
		}
		return list;
	} catch (error) {
		if (
			isConstraintError(error, "P2025") ||
			isConstraintError(error, "NO_ROWS")
		) {
			throw NotFoundError("List not found");
		}
		throw error;
	}
}

async function deleteList(listId: string): Promise<void> {
	try {
		await db.orm.public.List.where({ id: listId }).delete();
	} catch (error) {
		if (
			isConstraintError(error, "P2025") ||
			isConstraintError(error, "NO_ROWS")
		) {
			throw NotFoundError("List not found");
		}
		throw error;
	}
}

async function getListById(listId: string): Promise<List> {
	const list = await db.orm.public.List.where({ id: listId }).first();

	if (!list) {
		throw NotFoundError("List not found");
	}

	return list;
}

async function getBoardLists(boardId: string): Promise<List[]> {
	return db.orm.public.List
		.where({ boardId })
		.orderBy((list) => list.position.asc())
		.all();
}

export type { List, ListUpdates };
export {
	calculateInitialPosition,
	createList,
	updateList,
	deleteList,
	getListById,
	getBoardLists,
};
