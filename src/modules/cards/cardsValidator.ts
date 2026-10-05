import { z } from "zod";
import { BadRequestError } from "../errors/AppError";

const cardTitleSchema = z
	.string()
	.trim()
	.min(1, "Title is required")
	.max(200, "Title must be 200 characters or less");

const cardDescriptionSchema = z
	.string()
	.trim()
	.max(2000, "Description must be 2000 characters or less");

const cardPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const cardDueDateSchema = z.iso.datetime({ offset: true });
const cardIdValueSchema = z.string().cuid2();

const createCardSchema = z.object({
	title: cardTitleSchema,
	description: cardDescriptionSchema.optional(),
	priority: cardPrioritySchema.nullable().optional(),
	dueDate: cardDueDateSchema.nullable().optional(),
});

const updateCardSchema = z
	.object({
		title: cardTitleSchema.optional(),
		description: cardDescriptionSchema.optional(),
		priority: cardPrioritySchema.nullable().optional(),
		dueDate: cardDueDateSchema.nullable().optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

const moveCardSchema = z
	.object({
		toListId: cardIdValueSchema,
		version: z.number().int().nonnegative("Version must be non-negative"),
		beforeCardId: cardIdValueSchema.optional(),
		afterCardId: cardIdValueSchema.optional(),
	})
	.refine(
		(value) =>
			(value.beforeCardId === undefined) !==
			(value.afterCardId === undefined),
		{
			message: "Exactly one of beforeCardId or afterCardId must be provided",
		},
	);

const cardIdSchema = z.object({
	id: cardIdValueSchema,
});

const listIdSchema = z.object({
	id: cardIdValueSchema,
});

type CreateCardRequest = z.infer<typeof createCardSchema>;
type UpdateCardRequest = z.infer<typeof updateCardSchema>;
type MoveCardRequest = z.infer<typeof moveCardSchema>;
type CardIdRequest = z.infer<typeof cardIdSchema>;
type ListIdRequest = z.infer<typeof listIdSchema>;

function parseSchema<T>(schema: z.ZodType<T>, data: unknown): T {
	try {
		return schema.parse(data);
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw BadRequestError(error.message);
		}
		throw error;
	}
}

function validateCreateCardPayload(data: unknown): CreateCardRequest {
	return parseSchema(createCardSchema, data);
}

function validateUpdateCardPayload(data: unknown): UpdateCardRequest {
	return parseSchema(updateCardSchema, data);
}

function validateMoveCardPayload(data: unknown): MoveCardRequest {
	return parseSchema(moveCardSchema, data);
}

function validateCardId(id: unknown): CardIdRequest {
	return parseSchema(cardIdSchema, { id });
}

function validateListId(id: unknown): ListIdRequest {
	return parseSchema(listIdSchema, { id });
}

export {
	createCardSchema,
	updateCardSchema,
	moveCardSchema,
	cardIdSchema,
	listIdSchema,
	validateCreateCardPayload,
	validateUpdateCardPayload,
	validateMoveCardPayload,
	validateCardId,
	validateListId,
	type CreateCardRequest,
	type UpdateCardRequest,
	type MoveCardRequest,
	type CardIdRequest,
	type ListIdRequest,
};
