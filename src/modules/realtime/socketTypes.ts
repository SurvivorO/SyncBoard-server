import type { Socket, Server } from "socket.io";

export interface SocketData {
	userId?: string;
	email?: string;
}

export interface ServerToClientEvents {
	error: (err: { message: string; code?: string }) => void;
	[key: string]: (...args: any[]) => void;
}

export interface ClientToServerEvents {
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

