import { z } from "zod";
import { BadRequestError } from "../errors/AppError";

const listTitleSchema = z
	.string()
	.trim()
	.min(1, "Title is required")
	.max(100, "Title must be 100 characters or less");

const createListSchema = z.object({
	title: listTitleSchema,
});

const updateListSchema = z
	.object({
		title: listTitleSchema.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

const listIdSchema = z.object({
	id: z.string().cuid2("Invalid list ID"),
});

const boardIdSchema = z.object({
	id: z.string().cuid2("Invalid board ID"),
});

type CreateListRequest = z.infer<typeof createListSchema>;
type UpdateListRequest = z.infer<typeof updateListSchema>;
type ListIdRequest = z.infer<typeof listIdSchema>;
type BoardIdRequest = z.infer<typeof boardIdSchema>;

function validateCreateListPayload(data: unknown): CreateListRequest {
	try {
		return createListSchema.parse(data);
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw BadRequestError(error.message);
		}
		throw error;
	}
}

function validateUpdateListPayload(data: unknown): UpdateListRequest {
	try {
		return updateListSchema.parse(data);
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw BadRequestError(error.message);
		}
		throw error;
	}
}

function validateListId(id: unknown): ListIdRequest {
	try {
		return listIdSchema.parse({ id });
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw BadRequestError(error.message);
		}
		throw error;
	}
}

function validateBoardId(id: unknown): BoardIdRequest {
	try {
		return boardIdSchema.parse({ id });
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw BadRequestError(error.message);
		}
		throw error;
	}
}

export {
	createListSchema,
	updateListSchema,
	listIdSchema,
	boardIdSchema,
	validateCreateListPayload,
	validateUpdateListPayload,
	validateListId,
	validateBoardId,
	type CreateListRequest,
	type UpdateListRequest,
	type ListIdRequest,
	type BoardIdRequest,
};
