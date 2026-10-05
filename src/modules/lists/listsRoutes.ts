import { Router, type Request, type Response } from "express";
import { authMiddleware } from "../auth/authMiddleware";
import {
	requireBoardEditor,
	validateListExists,
} from "./listsMiddleware";
import {
	createList,
	deleteList,
	updateList,
} from "./listsService";
import {
	validateBoardId,
	validateCreateListPayload,
	validateListId,
	validateUpdateListPayload,
} from "./listsValidator";

async function createListHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: boardId } = validateBoardId(req.params.id);
	const { title } = validateCreateListPayload(req.body);
	const list = await createList(boardId, title);

	res.status(201).json(list);
}

async function updateListHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: listId } = validateListId(req.params.id);
	const updates = validateUpdateListPayload(req.body);
	const list = await updateList(listId, updates);

	res.json(list);
}

async function deleteListHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: listId } = validateListId(req.params.id);
	await deleteList(listId);

	res.status(204).send();
}

const listsRoutes = Router();

listsRoutes.post(
	"/boards/:id/lists",
	authMiddleware,
	requireBoardEditor,
	createListHandler,
);
listsRoutes.patch(
	"/lists/:id",
	authMiddleware,
	requireBoardEditor,
	validateListExists,
	updateListHandler,
);
listsRoutes.delete(
	"/lists/:id",
	authMiddleware,
	requireBoardEditor,
	validateListExists,
	deleteListHandler,
);

export {
	listsRoutes,
	createListHandler,
	updateListHandler,
	deleteListHandler,
};
export default listsRoutes;
