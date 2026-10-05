import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../../../env.js";
import { socketAuthMiddleware } from "./socketAuth.js";
import { registerRoomHandlers } from "./socketRooms.js";
import type {
	AppServer,
	AppSocket,
	ClientToServerEvents,
	ServerToClientEvents,
	InterServerEvents,
	SocketData,
} from "./socketTypes.js";

let io: AppServer | null = null;

export function initSocketServer(httpServer: HttpServer): AppServer {
	io = new Server<
		ClientToServerEvents,
		ServerToClientEvents,
		InterServerEvents,
		SocketData
	>(httpServer, {
		cors: {
			origin: env.CORS_ORIGIN,
			methods: ["GET", "POST"],
			credentials: true,
		},
	});

	io.use(socketAuthMiddleware);

	io.on("connection", (socket: AppSocket) => {
		registerRoomHandlers(io as AppServer, socket);

		socket.on("error", (error: Error) => {
			console.error(`Socket error for ${socket.id}:`, error);
		});

		socket.on("disconnect", (reason: string) => {
			// Disconnection logging / cleanup hook
		});
	});

	return io;
}

export function getIO(): AppServer {
	if (!io) {
		throw new Error(
			"Socket.IO server has not been initialized. Call initSocketServer first."
		);
	}
	return io;
}

export async function closeSocketServer(): Promise<void> {
	if (io) {
		await new Promise<void>((resolve) => {
			io?.close(() => {
				resolve();
			});
		});
		io = null;
	}
}

