import { db } from "../../prisma/db";
import {
	ForbiddenError,
	NotFoundError,
} from "../errors/AppError";
import { MemberRole, type MemberRole as MemberRoleValue } from "./boardTypes";

interface CreateBoardInput {
	title: string;
	userId: string;
}

interface UpdateBoardInput {
	title?: string;
}

async function getMembership(boardId: string, userId: string) {
	return db.orm.public.Membership.where({ boardId, userId }).first();
}

async function createBoard(input: CreateBoardInput) {
	return db.transaction(async (tx) => {
		const board = await tx.orm.public.Board.create({
			title: input.title,
			ownerId: input.userId,
		});

		await tx.orm.public.Membership.create({
			boardId: board.id,
			userId: input.userId,
			role: MemberRole.OWNER,
		});

		return board;
	});
}

async function getBoardById(boardId: string) {
	const board = await db.orm.public.Board.where({ id: boardId }).first();

	if (!board) {
		throw NotFoundError("Board not found");
	}

	return board;
}

async function getBoardsByUserId(userId: string) {
	const memberships = await db.orm.public.Membership.where({
		userId,
	}).all();
	const boards = await Promise.all(
		memberships.map((membership) =>
			db.orm.public.Board.where({ id: membership.boardId }).first(),
		),
	);

	return boards.filter((board): board is NonNullable<typeof board> => board !== null);
}

async function getBoardWithDetails(boardId: string) {
	const board = await getBoardById(boardId);
	const memberships = await db.orm.public.Membership.where({
		boardId,
	}).all();
	const lists = await db.orm.public.List.where({ boardId }).all();
	const activities = await db.orm.public.Activity.where({ boardId }).all();

	const members = await Promise.all(
		memberships.map(async (membership) => ({
			...membership,
			user: await db.orm.public.User.where({ id: membership.userId }).first(),
		})),
	);
	const listsWithCards = await Promise.all(
		lists.map(async (list) => ({
			...list,
			cards: await db.orm.public.Card.where({ listId: list.id }).all(),
		})),
	);
	const activitiesWithUsers = await Promise.all(
		activities.map(async (activity) => ({
			...activity,
			user: activity.userId
				? await db.orm.public.User.where({ id: activity.userId }).first()
				: null,
		})),
	);

	members.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	listsWithCards.sort((a, b) => a.position.localeCompare(b.position));
	for (const list of listsWithCards) {
		list.cards.sort((a, b) => a.position.localeCompare(b.position));
	}
	activitiesWithUsers.sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
	);

	return {
		...board,
		owner: await db.orm.public.User.where({ id: board.ownerId }).first(),
		memberships: members,
		lists: listsWithCards,
		activities: activitiesWithUsers.slice(0, 50),
	};
}

async function updateBoard(
	boardId: string,
	userId: string,
	input: UpdateBoardInput,
) {
	const membership = await getMembership(boardId, userId);

	if (!membership) {
		throw NotFoundError("You are not a member of this board");
	}
	if (membership.role !== MemberRole.OWNER) {
		throw ForbiddenError("Only the owner can update the board");
	}
	if (input.title === undefined) {
		return getBoardById(boardId);
	}

	const board = await db.orm.public.Board.where({ id: boardId }).first();
	if (!board) {
		throw NotFoundError("Board not found");
	}

	return db.orm.public.Board.where({ id: boardId }).update({
		title: input.title,
	});
}

async function deleteBoard(boardId: string, userId: string): Promise<void> {
	const board = await getBoardById(boardId);

	if (board.ownerId !== userId) {
		throw ForbiddenError("Only the owner can delete the board");
	}

	await db.orm.public.Board.where({ id: boardId }).delete();
}

async function getUserBoardRole(
	boardId: string,
	userId: string,
): Promise<MemberRoleValue | null> {
	const membership = await getMembership(boardId, userId);
	return membership?.role ?? null;
}

function canUserWrite(role: MemberRoleValue | null): boolean {
	return role === MemberRole.OWNER || role === MemberRole.EDITOR;
}

function canUserRead(role: MemberRoleValue | null): boolean {
	return role !== null;
}

function canUserAdmin(role: MemberRoleValue | null): boolean {
	return role === MemberRole.OWNER;
}

export type { CreateBoardInput, UpdateBoardInput };
export {
	createBoard,
	getBoardById,
	getBoardsByUserId,
	getBoardWithDetails,
	updateBoard,
	deleteBoard,
	getUserBoardRole,
	canUserWrite,
	canUserRead,
	canUserAdmin,
};
