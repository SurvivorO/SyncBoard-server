import { getIO } from "./socketServer.js";
import { getBoardRoom } from "./socketRooms.js";
import type { Card } from "../cards/cardsService.js";

type CardEvent = "card:created" | "card:updated" | "card:moved" | "card:deleted";

export async function broadcastCardEvent(
	boardId: string,
	eventType: "card:deleted",
	payload: { boardId: string; cardId: string; listId: string }
): Promise<void>;
export async function broadcastCardEvent(
	boardId: string,
	eventType: "card:created" | "card:updated" | "card:moved",
	payload: { boardId: string; card: Card }
): Promise<void>;
export async function broadcastCardEvent(
	boardId: string,
	eventType: CardEvent,
	payload: any
): Promise<void> {
	try {
		const io = getIO();
		io.to(getBoardRoom(boardId)).emit(eventType, payload);
	} catch (error) {
		console.error(`Failed to broadcast ${eventType} to board ${boardId}:`, error);
	}
}

