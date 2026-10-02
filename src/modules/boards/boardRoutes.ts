import { Router, type Request, type Response } from "express";
import { BadRequestError } from "../errors/AppError";
import type { AuthenticatedRequest } from "../../types/server";
import { authMiddleware } from "../auth/authMiddleware";
import {
	requireBoardMember,
	requireBoardOwner,
} from "./boardMiddleware";
import {
	createBoard,
	deleteBoard,
	getBoardWithDetails,
	getBoardsByUserId,
	updateBoard,
} from "./boardService";
import {
	getBoardMembers,
	inviteMember,
	removeMember,
	updateMemberRole,
} from "./membershipService";
import {
	createBoardSchema,
	inviteMemberSchema,
	updateBoardSchema,
	updateMemberRoleSchema,
} from "./boardValidator";

function getUserId(req: Request): string {
	const userId = (req as unknown as AuthenticatedRequest).user?.userId;
	if (!userId) {
		throw BadRequestError("Authenticated user is required");
	}
	return userId;
}

function getRouteParam(req: Request, name: string): string {
	const value = req.params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw BadRequestError(`Missing route parameter: ${name}`);
	}
	return value;
}

async function createBoardHandler(req: Request, res: Response): Promise<void> {
	const input = createBoardSchema().parse(req.body);
	const board = await createBoard({
		title: input.title,
		userId: getUserId(req),
	});

	res.status(201).json({
		success: true,
		data: board,
	});
}

async function listBoardsHandler(req: Request, res: Response): Promise<void> {
	const boards = await getBoardsByUserId(getUserId(req));

	res.json({
		success: true,
		data: boards,
		count: boards.length,
	});
}

async function getBoardHandler(req: Request, res: Response): Promise<void> {
	const board = await getBoardWithDetails(getRouteParam(req, "id"));

	res.json({
		success: true,
		data: board,
	});
}

async function updateBoardHandler(req: Request, res: Response): Promise<void> {
	const input = updateBoardSchema().parse(req.body);
	if (input.title === undefined) {
		throw BadRequestError("At least one field must be provided");
	}

	const board = await updateBoard(
		getRouteParam(req, "id"),
		getUserId(req),
		input,
	);

	res.json({
		success: true,
		data: board,
	});
}

async function deleteBoardHandler(req: Request, res: Response): Promise<void> {
	await deleteBoard(getRouteParam(req, "id"), getUserId(req));

	res.json({
		success: true,
		message: "Board deleted successfully",
	});
}

async function listMembersHandler(req: Request, res: Response): Promise<void> {
	const members = await getBoardMembers(getRouteParam(req, "id"));

	res.json({
		success: true,
		data: members,
		count: members.length,
	});
}

async function inviteMemberHandler(req: Request, res: Response): Promise<void> {
	const input = inviteMemberSchema().parse(req.body);
	const membership = await inviteMember(
		getRouteParam(req, "id"),
		getUserId(req),
		input,
	);

	res.status(201).json({
		success: true,
		data: membership,
	});
}

async function updateMemberRoleHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const input = updateMemberRoleSchema().parse(req.body);
	const membership = await updateMemberRole(
		getRouteParam(req, "id"),
		getRouteParam(req, "userId"),
		getUserId(req),
		input,
	);

	res.json({
		success: true,
		data: membership,
	});
}

async function removeMemberHandler(req: Request, res: Response): Promise<void> {
	await removeMember(
		getRouteParam(req, "id"),
		getRouteParam(req, "userId"),
		getUserId(req),
	);

	res.json({
		success: true,
		message: "Member removed successfully",
	});
}

function boardRoutes(): Router {
	const router = Router();

	router.post("/", authMiddleware, createBoardHandler);
	router.get("/", authMiddleware, listBoardsHandler);
	router.get(
		"/:id",
		authMiddleware,
		requireBoardMember,
		getBoardHandler,
	);
	router.patch(
		"/:id",
		authMiddleware,
		requireBoardMember,
		requireBoardOwner,
		updateBoardHandler,
	);
	router.delete(
		"/:id",
		authMiddleware,
		requireBoardMember,
		requireBoardOwner,
		deleteBoardHandler,
	);
	router.get(
		"/:id/members",
		authMiddleware,
		requireBoardMember,
		listMembersHandler,
	);
	router.post(
		"/:id/members",
		authMiddleware,
		requireBoardMember,
		requireBoardOwner,
		inviteMemberHandler,
	);
	router.patch(
		"/:id/members/:userId",
		authMiddleware,
		requireBoardMember,
		requireBoardOwner,
		updateMemberRoleHandler,
	);
	router.delete(
		"/:id/members/:userId",
		authMiddleware,
		requireBoardMember,
		requireBoardOwner,
		removeMemberHandler,
	);

	return router;
}

export {
	boardRoutes,
};
