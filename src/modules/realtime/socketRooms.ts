import type { AppSocket, AppServer } from "./socketTypes.js";
import { getUserBoardRole } from "../boards/boardService.js";

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
			if (!userId) {
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
		} catch (error) {
			console.error(`Error leaving board room for socket ${socket.id}:`, error);
			socket.emit("error", {
				message: "Internal error",
				code: "SERVER_ERROR",
			});
		}
	});
}

