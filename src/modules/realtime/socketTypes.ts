import type { Socket, Server } from "socket.io";
import type { PresenceUser } from "./socketPresence.js";

export interface SocketData {
	userId?: string;
	email?: string;
}

export interface ServerToClientEvents {
	error: (err: { message: string; code?: string }) => void;
	auth_error: (err: { message: string; code?: string }) => void;
	"board:joined": (data: { boardId: string }) => void;
	"board:left": (data: { boardId: string }) => void;
	"presence:update": (data: { boardId: string; users: Record<string, PresenceUser> }) => void;
	[key: string]: (...args: any[]) => void;
}

export interface ClientToServerEvents {
	"board:join": (data: { boardId: string }) => void;
	"board:leave": (data: { boardId: string }) => void;
	[key: string]: (...args: any[]) => void;
}

export interface InterServerEvents {
	[key: string]: (...args: any[]) => void;
}

export type AppSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	InterServerEvents,
	SocketData
>;

export type AppServer = Server<
	ClientToServerEvents,
	ServerToClientEvents,
	InterServerEvents,
	SocketData
>;

