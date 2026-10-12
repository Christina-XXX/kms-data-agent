// 检索层(RAG):知识库负责存和管,本模块负责"找到资料"
// 采用 BM25 关键词检索 + 中文 bigram 语义近似 + 版本/有效期/适用范围/权限过滤。
// 不依赖外部向量服务(DeepSeek 无 embedding 接口),后续可无缝替换为向量召回 + RRF 融合。

const STOPWORDS = new Set(
	("的 了 和 是 在 与 或 及 对 为 把 被 就 都 而 又 很 也 还 要 有 从 到 请 问 我 你 他 它 们 这 那 些 个 之 以 因 所 能 会 可 并 如 若 其 于 等 该 此 不 没 无 非 更 最 太 很 呢 吗 吧 啊 呀 哦 啦 了 着 过 一个 什么 怎么 如何 为什么 哪些 哪个 多少 the a an of to and or in on for with is are was were be").split(/\s+/),
);

/** 分词:中文按单字 + 相邻 bigram,英文/数字按词;过滤停用词 */
export function tokenize(text) {
	const t = String(text || "").toLowerCase();
	const tokens = [];
	const cjk = t.match(/[\u4e00-\u9fff]+/g) || [];
	for (const run of cjk) {
		for (let i = 0; i < run.length; i++) {
			const ch = run[i];
			if (!STOPWORDS.has(ch)) tokens.push(ch);
			if (i + 1 < run.length) {
				const bg = run.slice(i, i + 2);
				if (!/^(的了|了和|是和|是在|在与)/.test(bg)) tokens.push(bg);
			}
		}
	}
	const words = t.match(/[a-z0-9][a-z0-9._\-/#]*/g) || [];
	for (const w of words) {
		if (w.length > 1 && !STOPWORDS.has(w)) tokens.push(w);
	}
	return tokens;
}

function termFreq(tokens) {
	const m = new Map();
	for (const tk of tokens) {
		m.set(tk, (m.get(tk) || 0) + 1);
	}
	return m;
}

/** 把正文切成段落/句子级 chunk,便于引用片段 */
export function chunkContent(content) {
	const text = String(content || "").trim();
	if (!text) return [""];
	const parts = text.split(/\n+/).filter(Boolean);
	const chunks = [];
	for (const p of parts) {
		const sentences = p.split(/(?<=[。!?;；])\s*/).filter(Boolean);
		if (sentences.length <= 1) chunks.push(p);
		else chunks.push(...sentences);
	}
	return chunks.length ? chunks : [text];
}

function compareVersions(a, b) {
	const pa = String(a || "0").split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
	const pb = String(b || "0").split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] || 0) - (pb[i] || 0);
		if (d !== 0) return d;
	}
	return 0;
}

function todayStr() {
	return new Date().toISOString().slice(0, 10);
}

/** 权限映射:角色 -> 允许读取的知识 permission 集合 */
export function rolePermissions(role) {
	switch (role) {
		case "quality": return new Set(["quality", "all"]);
		case "engineering": return new Set(["engineering", "all"]);
		case "equipment": return new Set(["equipment", "all"]);
		default: return new Set(["all"]);
	}
}

/** 检索入口:返回带引用编号、版本、有效期、依据标准的结果集 */
export function searchKnowledge(db, query, opts = {}) {
	const {
		role = "general",
		scope = "",
		category = "",
		limit = 5,
		includeExpired = false,
		status = "approved",
	} = opts;

	const allowed = rolePermissions(role);
	const today = todayStr();

	// 1) 数据库过滤:审核状态 + 权限 + 有效期 + 可选适用范围/分类
	let sql = `SELECT * FROM knowledge WHERE status = ?`;
	const params = [status];
	if (!includeExpired) {
		sql += ` AND (valid_to IS NULL OR valid_to = '' OR valid_to >= ?) AND (valid_from IS NULL OR valid_from = '' OR valid_from <= ?)`;
		params.push(today, today);
	}
	const rows = db.prepare(sql).all(...params);
	const candidates = rows.filter((r) => {
		const perms = String(r.permission || "all").split(",").map((s) => s.trim()).filter(Boolean);
		if (!perms.some((p) => allowed.has(p))) return false;
		if (scope) {
			const hay = `${r.scope || ""} ${r.title || ""} ${r.tags || ""} ${r.category || ""}`;
			if (!scope.split(/[,、\s]+/).filter(Boolean).some((s) => hay.includes(s))) return false;
		}
		if (category && r.category !== category) return false;
		return true;
	});

	if (!candidates.length) return [];

	// 2) 同标题多版本:只保留最高版本(知道"正确版本")
	const byTitle = new Map();
	for (const c of candidates) {
		const key = String(c.title || "").trim().toLowerCase();
		const prev = byTitle.get(key);
		if (!prev || compareVersions(c.version, prev.version) > 0) byTitle.set(key, c);
	}
	const dedup = [...byTitle.values()];

	// 3) BM25 打分(title/tags/summary 权重更高)
	const qTokens = tokenize(query);
	if (!qTokens.length) return dedup.slice(0, limit).map((c, i) => toResult(c, i));

	const docs = dedup.map((c) => ({
		row: c,
		text: `${c.title} ${c.tags} ${c.summary} ${c.content}`,
		boostText: `${c.title} ${c.title} ${c.tags} ${c.tags} ${c.summary} ${c.summary}`,
	}));
	const df = new Map();
	const docTokens = docs.map((d) => new Set(tokenize(d.text)));
	for (const set of docTokens) for (const tk of set) df.set(tk, (df.get(tk) || 0) + 1);
	const N = docs.length;
	const idf = new Map();
	for (const [tk, n] of df) idf.set(tk, Math.log(1 + (N - n + 0.5) / (n + 0.5)));

	const dlens = docTokens.map((s) => s.size);
	const avgdl = dlens.reduce((a, b) => a + b, 0) / Math.max(1, N);

	const scored = docs.map((d, idx) => {
		const base = termFreq(tokenize(d.text));
		const boost = termFreq(tokenize(d.boostText));
		const K = 1.5 * (0.25 + 0.75 * (dlens[idx] / Math.max(1, avgdl)));
		let score = 0;
		for (const q of qTokens) {
			const w = idf.get(q) || 0;
			const tf = (boost.get(q) || 0) + (base.get(q) || 0) * 0.4;
			if (tf > 0) score += w * ((tf * 2.5) / (tf + K));
		}
		// bigram 语义近似加分
		const qBigrams = new Set(qTokens.filter((x) => x.length === 2));
		const dBigrams = new Set([...base.keys()].filter((x) => x.length === 2));
		let overlap = 0;
		for (const b of qBigrams) if (dBigrams.has(b)) overlap++;
		if (qBigrams.size) score += overlap / qBigrams.size * 0.8;
		return { ...d, score };
	}).sort((a, b) => b.score - a.score);

	return scored.slice(0, limit).map((s, i) => toResult(s.row, i, s.score));
}

function toResult(row, i, score) {
	const chunks = chunkContent(row.content);
	// 取与标题/标签最相关的首个非空 chunk 作为引用片段
	const excerpt = chunks[0] || row.summary || "";
	return {
		id: row.id,
		ref: i + 1,
		title: row.title,
		category: row.category,
		tags: row.tags,
		summary: row.summary,
		excerpt,
		content: row.content,
		source: row.source,
		version: row.version,
		valid_from: row.valid_from,
		valid_to: row.valid_to,
		scope: row.scope,
		permission: row.permission,
		standard_ref: row.standard_ref,
		score: score === undefined ? null : Number(score.toFixed(4)),
	};
}

/** 格式化检索结果为工具返回文本,供模型引用 */
export function formatResults(results) {
	if (!results.length) return "未检索到相关知识(可能受权限、有效期或适用范围过滤影响)。";
	return results.map((r) => {
		const meta = [
			`[${r.ref}] ${r.title}`,
			`分类:${r.category || "未分类"}`,
			`版本:v${r.version || "1.0"}`,
			r.valid_from || r.valid_to ? `有效期:${r.valid_from || "不限"} ~ ${r.valid_to || "长期"}` : "",
			r.scope ? `适用范围:${r.scope}` : "",
			r.standard_ref ? `依据标准:${r.standard_ref}` : "",
		].filter(Boolean).join(" · ");
		return `${meta}\n引用片段:${r.excerpt}`;
	}).join("\n\n");
}

/** 治理分析:过期 / 即将过期 / 重复 / 无版本 */
export function governanceReport(db) {
	const rows = db.prepare("SELECT * FROM knowledge WHERE status != 'archived' ORDER BY id DESC").all();
	const today = todayStr();
	const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
	const expired = [];
	const expiring = [];
	const noVersion = [];
	const byTitle = new Map();
	for (const r of rows) {
		if (r.valid_to && r.valid_to < today) expired.push(r);
		else if (r.valid_to && r.valid_to <= in30) expiring.push(r);
		if (!r.version || !String(r.version).trim()) noVersion.push(r);
		const key = String(r.title || "").trim().toLowerCase();
		if (!byTitle.has(key)) byTitle.set(key, []);
		byTitle.get(key).push(r);
	}
	const duplicates = [];
	for (const [key, list] of byTitle) {
		if (list.length > 1) duplicates.push({ title: key, count: list.length, rows: list });
	}
	return { expired, expiring, noVersion, duplicates, total: rows.length };
}
