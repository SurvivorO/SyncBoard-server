import { z } from "zod";

function createBoardSchema() {
	return z.object({
		title: z
			.string()
			.min(1, "Title is required")
			.max(255, "Title must be 255 characters or less"),
	});
}

type CreateBoardRequest = z.infer<ReturnType<typeof createBoardSchema>>;

function updateBoardSchema() {
	return z.object({
		title: z
			.string()
			.min(1, "Title is required")
			.max(255, "Title must be 255 characters or less")
			.optional(),
	});
}

type UpdateBoardRequest = z.infer<ReturnType<typeof updateBoardSchema>>;

function inviteMemberSchema() {
	return z.object({
		email: z.string().trim().email("Invalid email address"),
		role: z.enum(["OWNER", "EDITOR", "VIEWER"]),
	});
}

type InviteMemberRequest = z.infer<ReturnType<typeof inviteMemberSchema>>;

function updateMemberRoleSchema() {
	return z.object({
		role: z.enum(["EDITOR", "VIEWER"]),
	});
}

type UpdateMemberRoleRequest = z.infer<
	ReturnType<typeof updateMemberRoleSchema>
>;

export {
	createBoardSchema,
	updateBoardSchema,
	inviteMemberSchema,
	updateMemberRoleSchema,
	type CreateBoardRequest,
	type UpdateBoardRequest,
	type InviteMemberRequest,
	type UpdateMemberRoleRequest,
};
