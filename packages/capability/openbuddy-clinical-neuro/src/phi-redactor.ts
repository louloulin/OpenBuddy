/**
 * PHI (Protected Health Information) redactor.
 *
 * All clinical text sent to an external LLM MUST pass through this module
 * first. Applies deterministic pattern-based redaction for identifiers
 * defined in HIPAA Safe Harbor and China's Personal Information Protection
 * Law (PIPL). Redaction is best-effort; the audit log records the redaction
 * fingerprint so downstream consumers can verify it ran.
 */

export interface PhiRedactionResult {
	/** Redacted text — safe to send to external services. */
	readonly redacted: string;
	/** Number of each PHI category that was redacted. */
	readonly stats: PhiRedactionStats;
	/** Stable hash of the redacted output, for audit logging. */
	readonly fingerprint: string;
}

export interface PhiRedactionStats {
	idCard: number;
	phone: number;
	email: number;
	ipAddress: number;
	dateOfBirth: number;
	medicalRecordNumber: number;
	chineseName: number;
	address: number;
	total: number;
}

export interface PhiEntity {
	readonly category: keyof PhiRedactionStats;
	readonly start: number;
	readonly end: number;
	/** Placeholder token, e.g. [PHI-IDCARD-1] */
	readonly placeholder: string;
}

const ID_CARD_RE = /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g;
const PHONE_RE = /\b1[3-9]\d{9}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IP_V4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;
const DATE_RE = /\b(?:19|20)\d{2}[-/年](?:0?[1-9]|1[0-2])[-/月](?:0?[1-9]|[12]\d|3[01])日?\b/g;
const MRN_RE = /(?:门诊号|住院号|病历号|登记号|ID)[:：\s]*[A-Za-z0-9-]{4,20}/gi;
const ADDRESS_RE = /(?:省|市|区|县|镇|乡|村|路|街|号|栋|单元|室)[\d\-号栋单元室]{2,}/g;
/**
 * Chinese person names in clinical narrative: 2-4 CJK chars followed by
 * context markers like 患者/病人 or preceded by them. Conservative — only
 * redacts when a medical-context marker is adjacent.
 */
const NAME_CONTEXT_RE = /(?:患者|病人|家属|联系人)[:：\s]*([\u4e00-\u9fa5]{2,4})(?=[，。、；：\s]|$)/g;
const NAME_PREFIX_RE = /([\u4e00-\u9fa5]{2,4})(?:，|主诉|现病史|既往史)/g;

/** CJK surname reference for confidence scoring (top ~120 Chinese surnames). */
const COMMON_SURNAMES = new Set([
	"王", "李", "张", "刘", "陈", "杨", "黄", "赵", "吴", "周", "徐", "孙", "马", "朱",
	"胡", "郭", "何", "林", "罗", "高", "郑", "梁", "谢", "宋", "唐", "韩", "冯", "于",
	"董", "萧", "程", "曹", "袁", "邓", "许", "傅", "沈", "曾", "彭", "吕", "苏", "卢",
	"蒋", "蔡", "贾", "丁", "魏", "薛", "叶", "阎", "余", "潘", "杜", "戴", "夏", "钟",
	"汪", "田", "任", "姜", "范", "方", "石", "姚", "谭", "廖", "邹", "熊", "金", "陆",
	"郝", "孔", "白", "崔", "康", "毛", "邱", "秦", "江", "史", "顾", "侯", "邵", "孟",
	"龙", "万", "段", "雷", "钱", "汤", "尹", "黎", "易", "常", "武", "乔", "贺", "赖",
	"龚", "文",
]);

function simpleHash(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function findMatches(text: string): PhiEntity[] {
	const entities: PhiEntity[] = [];
	const counters = new Map<string, number>();
	const placeholder = (category: string): string => {
		const count = (counters.get(category) ?? 0) + 1;
		counters.set(category, count);
		return `[PHI-${category.toUpperCase()}-${count}]`;
	};
	const push = (category: keyof PhiRedactionStats, re: RegExp, validator?: (match: string) => boolean): void => {
		re.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = re.exec(text)) !== null) {
			const value = match[0];
			if (validator && !validator(value)) continue;
			entities.push({ category, start: match.index, end: match.index + value.length, placeholder: placeholder(category) });
		}
	};

	push("idCard", ID_CARD_RE);
	push("phone", PHONE_RE);
	push("email", EMAIL_RE);
	push("ipAddress", IP_V4_RE);
	push("dateOfBirth", DATE_RE);
	push("medicalRecordNumber", MRN_RE);

	// Contextual Chinese name detection — only when adjacent to medical markers.
	const nameRe = /(?:患者|病人|家属|联系人)[:：\s]+([\u4e00-\u9fa5]{2,4})(?=[，。、；：\s(（]|$)/g;
	let nameMatch: RegExpExecArray | null;
	while ((nameMatch = nameRe.exec(text)) !== null) {
		const name = nameMatch[1];
		if (COMMON_SURNAMES.has(name[0])) {
			const start = nameMatch.index + nameMatch[0].indexOf(name);
			entities.push({ category: "chineseName", start, end: start + name.length, placeholder: placeholder("chineseName") });
		}
	}

	// Address fragments.
	push("address", ADDRESS_RE);

	// Sort by start position; later overlapping matches are dropped.
	entities.sort((a, b) => a.start - b.start || b.end - a.end);
	const nonOverlapping: PhiEntity[] = [];
	let lastEnd = -1;
	for (const entity of entities) {
		if (entity.start >= lastEnd) {
			nonOverlapping.push(entity);
			lastEnd = entity.end;
		}
	}
	return nonOverlapping;
}

export function redactPhi(input: string): PhiRedactionResult {
	if (!input) {
		return { redacted: "", stats: { idCard: 0, phone: 0, email: 0, ipAddress: 0, dateOfBirth: 0, medicalRecordNumber: 0, chineseName: 0, address: 0, total: 0 }, fingerprint: simpleHash("") };
	}
	const entities = findMatches(input);
	const stats: PhiRedactionStats = { idCard: 0, phone: 0, email: 0, ipAddress: 0, dateOfBirth: 0, medicalRecordNumber: 0, chineseName: 0, address: 0, total: 0 };
	let result = "";
	let cursor = 0;
	for (const entity of entities) {
		result += input.slice(cursor, entity.start) + entity.placeholder;
		cursor = entity.end;
		stats[entity.category] += 1;
		stats.total += 1;
	}
	result += input.slice(cursor);
	return { redacted: result, stats, fingerprint: simpleHash(result) };
}

/**
 * Replace a placeholder with its original value (for display to an
 * authenticated clinician only — never for LLM calls).
 */
export function restorePhi(redacted: string, mapping: Map<string, string>): string {
	let result = redacted;
	for (const [placeholder, original] of mapping) {
		result = result.split(placeholder).join(original);
	}
	return result;
}
