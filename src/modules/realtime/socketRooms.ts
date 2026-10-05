import type { AppSocket, AppServer } from "./socketTypes.js";
import { getUserBoardRole } from "../boards/boardService.js";
import { addPresence, removePresence } from "./socketPresence.js";

export function getBoardRoom(boardId: string): string {
	return `board_${boardId}`;
}

export function registerRoomHandlers(
	io: AppServer,
	socket: AppSocket
): void {
	socket.on("board:join", async (data: { boardId: string }) => {
		try {
			const userId = socket.data.userId;
			const email = socket.data.email;
			if (!userId || !email) {
				socket.emit("error", {
					message: "Not authenticated",
					code: "UNAUTHORIZED",
				});
				return;
			}

			if (!data || typeof data.boardId !== "string" || !data.boardId.trim()) {
				socket.emit("error", {
					message: "Missing boardId",
					code: "INVALID_PAYLOAD",
				});
				return;
			}

			const boardId = data.boardId.trim();
			const role = await getUserBoardRole(boardId, userId);

			if (!role) {
				socket.emit("error", {
					message: "Access denied",
					code: "FORBIDDEN",
				});
				return;
			}

			await socket.join(getBoardRoom(boardId));
			socket.emit("board:joined", { boardId });

			const users = await addPresence(boardId, userId, email, socket.id);
			io.to(getBoardRoom(boardId)).emit("presence:update", { boardId, users });
		} catch (error) {
			console.error(`Error joining board room for socket ${socket.id}:`, error);
			socket.emit("error", {
				message: "Internal error",
				code: "SERVER_ERROR",
			});
		}
	});

	socket.on("board:leave", async (data: { boardId: string }) => {
		try {
			const userId = socket.data.userId;
			if (!userId) return;

			if (!data || typeof data.boardId !== "string" || !data.boardId.trim()) {
				socket.emit("error", {
					message: "Missing boardId",
					code: "INVALID_PAYLOAD",
				});
				return;
			}

			const boardId = data.boardId.trim();
			await socket.leave(getBoardRoom(boardId));
			socket.emit("board:left", { boardId });

			const users = removePresence(boardId, userId, socket.id);
			io.to(getBoardRoom(boardId)).emit("presence:update", { boardId, users });
		} catch (error) {
			console.error(`Error leaving board room for socket ${socket.id}:`, error);
			socket.emit("error", {
				message: "Internal error",
				code: "SERVER_ERROR",
			});
		}
	});
}

