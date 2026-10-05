import { Router, type Request, type Response } from "express";
import { authMiddleware } from "../auth/authMiddleware";
import {
	requireBoardEditor,
	validateCardExists,
	validateMovePayload,
	validateTargetList,
} from "./cardsMiddleware";
import {
	createCard,
	deleteCard,
	moveCard,
	updateCard,
} from "./cardsService";
import {
	validateCardId,
	validateCreateCardPayload,
	validateListId,
	validateMoveCardPayload,
	validateUpdateCardPayload,
} from "./cardsValidator";
import { validateListExists } from "../lists/listsMiddleware";

async function createCardHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: listId } = validateListId(req.params.id);
	const { title, description, priority, dueDate } =
		validateCreateCardPayload(req.body);
	const card = await createCard(
		listId,
		title,
		description,
		priority,
		dueDate,
	);

	res.status(201).json(card);
}

async function updateCardHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: cardId } = validateCardId(req.params.id);
	const updates = validateUpdateCardPayload(req.body);
	const card = await updateCard(cardId, updates);

	res.json(card);
}

async function deleteCardHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: cardId } = validateCardId(req.params.id);
	await deleteCard(cardId);

	res.status(204).send();
}

async function moveCardHandler(
	req: Request,
	res: Response,
): Promise<void> {
	const { id: cardId } = validateCardId(req.params.id);
	const { toListId, beforeCardId, afterCardId, version } =
		validateMoveCardPayload(req.body);
	const card = await moveCard(
		cardId,
		toListId,
		beforeCardId,
		afterCardId,
		version,
	);

	res.json(card);
}

const cardsRoutes = Router();

cardsRoutes.post(
	"/lists/:id/cards",
	authMiddleware,
	validateListExists,
	requireBoardEditor,
	createCardHandler,
);
cardsRoutes.patch(
	"/cards/:id",
	authMiddleware,
	validateCardExists,
	requireBoardEditor,
	updateCardHandler,
);
cardsRoutes.delete(
	"/cards/:id",
	authMiddleware,
	validateCardExists,
	requireBoardEditor,
	deleteCardHandler,
);
cardsRoutes.post(
	"/cards/:id/move",
	authMiddleware,
	validateCardExists,
	validateMovePayload,
	requireBoardEditor,
	validateTargetList,
	moveCardHandler,
);

export {
	cardsRoutes,
	createCardHandler,
	updateCardHandler,
	deleteCardHandler,
	moveCardHandler,
};
export default cardsRoutes;
