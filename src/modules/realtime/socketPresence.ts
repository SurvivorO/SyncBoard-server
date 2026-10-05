import { db } from "../../prisma/db.js";

export interface PresenceUser {
	userId: string;
	userName: string | null;
	userEmail: string;
	joinedAt: number;
}

interface InternalPresenceUser extends PresenceUser {
	socketIds: Set<string>;
}

const presenceMap = new Map<string, Map<string, InternalPresenceUser>>();

export async function addPresence(
	boardId: string,
	userId: string,
	email: string,
	socketId: string
): Promise<Record<string, PresenceUser>> {
	if (!presenceMap.has(boardId)) {
		presenceMap.set(boardId, new Map());
	}
	const boardPresence = presenceMap.get(boardId)!;

	if (boardPresence.has(userId)) {
		const userPresence = boardPresence.get(userId)!;
		userPresence.socketIds.add(socketId);
	} else {
		const user = await db.orm.public.User.where({ id: userId }).first();
		const userName = user?.name ?? null;

		boardPresence.set(userId, {
			userId,
			userName,
			userEmail: email,
			joinedAt: Date.now(),
			socketIds: new Set([socketId]),
		});
	}

	return getPresence(boardId);
}

export function removePresence(
	boardId: string,
	userId: string,
	socketId: string
): Record<string, PresenceUser> {
	const boardPresence = presenceMap.get(boardId);
	if (!boardPresence) return {};

	const userPresence = boardPresence.get(userId);
	if (userPresence) {
		userPresence.socketIds.delete(socketId);
		if (userPresence.socketIds.size === 0) {
			boardPresence.delete(userId);
		}
	}

	if (boardPresence.size === 0) {
		presenceMap.delete(boardId);
		return {};
	}

	return getPresence(boardId);
}

export function getPresence(boardId: string): Record<string, PresenceUser> {
	const boardPresence = presenceMap.get(boardId);
	if (!boardPresence) return {};

	const result: Record<string, PresenceUser> = {};
	for (const [userId, user] of boardPresence.entries()) {
		result[userId] = {
			userId: user.userId,
			userName: user.userName,
			userEmail: user.userEmail,
			joinedAt: user.joinedAt,
		};
	}
	return result;
}

export function removePresenceFromAll(
	socketId: string
): { boardId: string; users: Record<string, PresenceUser> }[] {
	const updates: { boardId: string; users: Record<string, PresenceUser> }[] = [];

	for (const [boardId, boardPresence] of presenceMap.entries()) {
		let removedUser = false;
		for (const [userId, userPresence] of boardPresence.entries()) {
			if (userPresence.socketIds.has(socketId)) {
				userPresence.socketIds.delete(socketId);
				if (userPresence.socketIds.size === 0) {
					boardPresence.delete(userId);
				}
				removedUser = true;
				break;
			}
		}

		if (removedUser) {
			if (boardPresence.size === 0) {
				presenceMap.delete(boardId);
			}
			updates.push({ boardId, users: getPresence(boardId) });
		}
	}

	return updates;
}

