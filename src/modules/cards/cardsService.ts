import fractionalIndex from "fractional-index";
import { Temporal } from "@js-temporal/polyfill";
import { db } from "../../prisma/db";
import type { Models } from "../../prisma/contract";
import {
	BadRequestError,
	ConflictError,
	NotFoundError,
} from "../errors/AppError";
import type {
	CreateCardRequest,
	UpdateCardRequest,
} from "./cardsValidator";

type Card = Pick<
	Models.public_Card,
	| "createdAt"
	| "description"
	| "dueDate"
	| "id"
	| "listId"
	| "position"
	| "priority"
	| "title"
	| "updatedAt"
	| "version"
>;

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

function toInstant(value: string | null | undefined): Temporal.Instant | null | undefined {
	if (value === undefined || value === null) {
		return value;
	}

	return Temporal.Instant.from(value);
}

function getCardPosition(
	afterPosition: string | null,
	beforePosition: string | null,
): string {
	return fractionalIndex(afterPosition, beforePosition);
}

async function calculateCardPosition(
	_listId: string,
	afterPosition: string | null = null,
	beforePosition: string | null = null,
): Promise<string> {
	return getCardPosition(afterPosition, beforePosition);
}

async function createCard(
	listId: string,
	title: string,
	description?: CreateCardRequest["description"],
	priority?: CreateCardRequest["priority"],
	dueDate?: CreateCardRequest["dueDate"],
): Promise<Card> {
	const list = await db.orm.public.List.where({ id: listId }).first();
	if (!list) {
		throw NotFoundError("List not found");
	}

	const lastCard = await db.orm.public.Card
		.where({ listId })
		.orderBy((card) => card.position.desc())
		.first();
	const position = await calculateCardPosition(
		listId,
		lastCard?.position ?? null,
		null,
	);

	try {
		return await db.orm.public.Card.create({
			listId,
			title,
			description: description ?? null,
			priority: priority ?? null,
			dueDate: toInstant(dueDate),
			position,
			version: 0,
		});
	} catch (error) {
		if (isConstraintError(error, "23505") || isConstraintError(error, "P2002")) {
			throw ConflictError("A card position conflict occurred. Please try again.");
		}
		if (isConstraintError(error, "23503") || isConstraintError(error, "P2003")) {
			throw NotFoundError("List not found");
		}
		throw error;
	}
}

async function updateCard(
	cardId: string,
	updates: UpdateCardRequest,
	expectedVersion?: number,
): Promise<Card> {
	if (Object.keys(updates).length === 0) {
		throw BadRequestError("No fields to update");
	}

	const currentCard = await db.orm.public.Card.where({ id: cardId }).first();
	if (!currentCard) {
		throw NotFoundError("Card not found");
	}
	if (
		expectedVersion !== undefined &&
		expectedVersion < currentCard.version
	) {
		throw ConflictError("Card was modified by another request");
	}

	try {
		const updatedCard = await db.orm.public.Card.where({ id: cardId }).update({
			...updates,
			dueDate: toInstant(updates.dueDate),
			version: currentCard.version + 1,
		});
		if (!updatedCard) {
			throw NotFoundError("Card not found");
		}
		return updatedCard;
	} catch (error) {
		if (
			isConstraintError(error, "P2025") ||
			isConstraintError(error, "NO_ROWS")
		) {
			throw NotFoundError("Card not found");
		}
		throw error;
	}
}

async function deleteCard(cardId: string): Promise<void> {
	try {
		const deletedCard = await db.orm.public.Card.where({ id: cardId }).delete();
		if (!deletedCard) {
			throw NotFoundError("Card not found");
		}
	} catch (error) {
		if (
			isConstraintError(error, "P2025") ||
			isConstraintError(error, "NO_ROWS")
		) {
			throw NotFoundError("Card not found");
		}
		throw error;
	}
}

async function moveCard(
	cardId: string,
	toListId: string,
	beforeCardId: string | undefined,
	afterCardId: string | undefined,
	expectedVersion: number,
): Promise<Card> {
	if (
		(beforeCardId === undefined) ===
		(afterCardId === undefined)
	) {
		throw BadRequestError(
			"Exactly one of beforeCardId or afterCardId must be provided",
		);
	}

	return db.transaction(async (tx) => {
		const card = await tx.orm.public.Card.where({ id: cardId }).first();
		if (!card) {
			throw NotFoundError("Card not found");
		}
		if (expectedVersion < card.version) {
			throw ConflictError("Card was modified by another request");
		}

		const targetCards = await tx.orm.public.Card
			.where({ listId: toListId })
			.orderBy((targetCard) => targetCard.position.asc())
			.all();
		const cardsWithoutMovingCard = targetCards.filter(
			(targetCard) => targetCard.id !== cardId,
		);

		let afterPosition: string | null = null;
		let beforePosition: string | null = null;

		if (beforeCardId !== undefined) {
			const beforeIndex = cardsWithoutMovingCard.findIndex(
				(targetCard) => targetCard.id === beforeCardId,
			);
			if (beforeIndex < 0) {
				throw BadRequestError("Before card is not in the target list");
			}
			beforePosition = cardsWithoutMovingCard[beforeIndex].position;
			afterPosition =
				beforeIndex > 0
					? cardsWithoutMovingCard[beforeIndex - 1].position
					: null;
		} else if (afterCardId !== undefined) {
			const afterIndex = cardsWithoutMovingCard.findIndex(
				(targetCard) => targetCard.id === afterCardId,
			);
			if (afterIndex < 0) {
				throw BadRequestError("After card is not in the target list");
			}
			afterPosition = cardsWithoutMovingCard[afterIndex].position;
			beforePosition =
				afterIndex < cardsWithoutMovingCard.length - 1
					? cardsWithoutMovingCard[afterIndex + 1].position
					: null;
		}

		const position = await calculateCardPosition(
			toListId,
			afterPosition,
			beforePosition,
		);
		const updatedCard = await tx.orm.public.Card
			.where({ id: cardId, version: expectedVersion })
			.update({
				listId: toListId,
				position,
				version: expectedVersion + 1,
			});

		if (!updatedCard) {
			throw ConflictError("Card was modified by another request");
		}

		return updatedCard;
	});
}

async function getCardById(cardId: string): Promise<Card> {
	const card = await db.orm.public.Card.where({ id: cardId }).first();
	if (!card) {
		throw NotFoundError("Card not found");
	}
	return card;
}

async function getCardsByListId(listId: string): Promise<Card[]> {
	return db.orm.public.Card
		.where({ listId })
		.orderBy((card) => card.position.asc())
		.all();
}

export type { Card };
export {
	calculateCardPosition,
	createCard,
	updateCard,
	deleteCard,
	moveCard,
	getCardById,
	getCardsByListId,
};
