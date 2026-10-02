const MemberRole = {
	OWNER: "OWNER",
	EDITOR: "EDITOR",
	VIEWER: "VIEWER",
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export { MemberRole };
