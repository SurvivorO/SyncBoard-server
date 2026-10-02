import { db } from "../../prisma/db";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "../errors/AppError";
import { MemberRole, type MemberRole as MemberRoleValue } from "./boardTypes";
import { getUserBoardRole } from "./boardService";

interface InviteMemberInput {
	email: string;
	role: MemberRoleValue;
}

interface UpdateMembershipInput {
	role: MemberRoleValue;
}

async function requireOwner(boardId: string, userId: string) {
	const role = await getUserBoardRole(boardId, userId);
	if (role !== MemberRole.OWNER) {
		throw ForbiddenError("Only the owner can manage board members");
	}
}

async function getMembership(boardId: string, userId: string) {
	return db.orm.public.Membership.where({ boardId, userId }).first();
}

async function withUser(
	membership: NonNullable<Awaited<ReturnType<typeof getMembership>>>,
) {
	return {
		...membership,
		user: await db.orm.public.User.where({ id: membership.userId }).first(),
	};
}

async function inviteMember(
	boardId: string,
	requestingUserId: string,
	input: InviteMemberInput,
) {
	await requireOwner(boardId, requestingUserId);

	const targetUser = await db.orm.public.User.where({ email: input.email }).first();
	if (!targetUser) {
		throw BadRequestError(
			"No user found with that email. They must register first.",
		);
	}
	if (targetUser.id === requestingUserId) {
		throw BadRequestError("You are already a member of this board");
	}
	if (await getMembership(boardId, targetUser.id)) {
		throw ConflictError("User is already a member of this board");
	}

	const membership = await db.orm.public.Membership.create({
		boardId,
		userId: targetUser.id,
		role: input.role,
	});

	return { ...membership, user: targetUser };
}

async function getBoardMembers(boardId: string) {
	const memberships = await db.orm.public.Membership.where({
		boardId,
	}).all();
	const members = await Promise.all(memberships.map(withUser));
	return members.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function updateMemberRole(
	boardId: string,
	targetUserId: string,
	requestingUserId: string,
	input: UpdateMembershipInput,
) {
	await requireOwner(boardId, requestingUserId);

	const membership = await getMembership(boardId, targetUserId);
	if (!membership) {
		throw NotFoundError("Member not found");
	}
	if (membership.role === MemberRole.OWNER) {
		throw ForbiddenError("Cannot change the owner role");
	}
	if (input.role === MemberRole.OWNER) {
		throw BadRequestError("The owner role cannot be assigned to another member");
	}

	const updated = await db.orm.public.Membership.where({
		id: membership.id,
	}).update({ role: input.role });

	return {
		...updated,
		user: await db.orm.public.User.where({ id: targetUserId }).first(),
	};
}

async function removeMember(
	boardId: string,
	targetUserId: string,
	requestingUserId: string,
): Promise<void> {
	await requireOwner(boardId, requestingUserId);

	const membership = await getMembership(boardId, targetUserId);
	if (!membership) {
		throw NotFoundError("Member not found");
	}
	if (membership.role === MemberRole.OWNER) {
		throw ForbiddenError(
			"Cannot remove the owner. Delete the board or remove other members.",
		);
	}

	await db.orm.public.Membership.where({ id: membership.id }).delete();
}

function hasPermission(
	role: MemberRoleValue | null,
	action: "read" | "write" | "admin",
): boolean {
	if (role === null) return false;
	if (action === "read") return true;
	if (action === "write") return role === MemberRole.OWNER || role === MemberRole.EDITOR;
	return role === MemberRole.OWNER;
}

export type { InviteMemberInput, UpdateMembershipInput };
export {
	inviteMember,
	getBoardMembers,
	updateMemberRole,
	removeMember,
	hasPermission,
};
