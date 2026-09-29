export type JWTPayload = {
    userId: string;
    email: string;
};

export type AuthenticatedRequest = Express.Request & {
    user: JWTPayload;
};