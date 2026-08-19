export interface XaiCompactionItem {
	type: "compaction";
	id: string;
	encrypted_content: string;
}

export interface XaiCompactionDetails {
	xaiCompaction?: XaiCompactionItem;
	tokensBefore?: number;
	[key: string]: unknown;
}
