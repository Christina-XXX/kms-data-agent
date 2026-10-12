// 服务入口:HTTP 静态文件 + WebSocket 对话通道 + 历史记录 API
import http from "node:http";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { createHash, randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import { initDb } from "./db.js";
import { createDataAgent } from "./agent.js";
import { searchKnowledge, governanceReport } from "./rag.js";
import { EXPERT_ROLES, getRole } from "./skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HISTORY_DIR = join(__dirname, "../history");
const ARTIFACT_DIR = join(__dirname, "../data/artifacts");
mkdirSync(HISTORY_DIR, { recursive: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

console.log("① 初始化示例数据库(SQLite)...");
const db = initDb();

let currentRole = "general"; // 当前专家模式(随每次提问更新)

console.log("② 初始化 Data Agent(DeepSeek + RAG 检索 + Skills + Tools)...");
const { session, model } = await createDataAgent(db, (payload) => {
	// 数据库工具被调用时:记录到当前问答 + 推送给前端展示
	if (current) {
		current.segments.push({ type: "query", sql: payload.sql, rows: payload.rows, count: payload.count });
	}
	broadcast({ type: "query", sql: payload.sql, rows: payload.rows, count: payload.count });
}, {
	getRole: () => currentRole,
	onSearch: (results) => {
		if (current) current.segments.push({ type: "citations", results });
		broadcast({ type: "citations", results });
	},
	onArtifact: (a) => {
		if (current) current.segments.push({ type: "artifact", ...a });
		broadcast({ type: "artifact", ...a });
	},
});
console.log(`③ Data Agent 就绪,模型: ${model.provider}/${model.id}\n`);

let activeWs = null;
let current = null; // 当前一轮问答的收集:{ userText, segments }

function broadcast(obj) {
	if (activeWs && activeWs.readyState === 1) {
		activeWs.send(JSON.stringify(obj));
	}
}

// —— 历史记录 ——
function listHistory() {
	try {
		return readdirSync(HISTORY_DIR)
			.filter((f) => f.endsWith(".json"))
			.map((f) => {
				const rec = JSON.parse(readFileSync(join(HISTORY_DIR, f), "utf-8"));
				return { id: rec.id, title: rec.title, time: rec.time };
			})
			.sort((a, b) => b.time - a.time);
	} catch {
		return [];
	}
}

function loadHistory(id) {
	try {
		if (!/^[0-9]+$/.test(id)) return null;
		return JSON.parse(readFileSync(join(HISTORY_DIR, id + ".json"), "utf-8"));
	} catch {
		return null;
	}
}

function saveHistory() {
	if (!current || !current.userText) return;
	const id = String(Date.now());
	const rec = {
		id,
		title: current.userText.slice(0, 30) + (current.userText.length > 30 ? "…" : ""),
		time: Date.now(),
		messages: [
			{ role: "user", text: current.userText },
			{ role: "assistant", segments: current.segments },
		],
	};
	writeFileSync(join(HISTORY_DIR, id + ".json"), JSON.stringify(rec, null, 2));
	current = null;
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
};

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > 30 * 1024 * 1024) reject(new Error("文件过大"));
		});
		req.on("end", () => {
			try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("请求体不是有效 JSON")); }
		});
		req.on("error", reject);
	});
}

// —— 登录认证 ——
const tokens = new Map(); // token -> userId
function hashPwd(phone, pwd) {
	return createHash("sha256").update(`${phone}:${pwd}:kms-salt`).digest("hex");
}
function getAuthUser(req) {
	const token = req.headers["x-token"] || new URL(req.url, "http://localhost").searchParams.get("token");
	if (!token) return null;
	const userId = tokens.get(token);
	if (!userId) return null;
	return db.prepare("SELECT id, phone, department FROM users WHERE id = ?").get(userId) || null;
}

function buildDraftPrompt(fileName, headers, rows) {
	const preview = rows.slice(0, 30).map((r) => {
		const obj = {};
		headers.forEach((h, i) => { obj[h] = r[i]; });
		return JSON.stringify(obj);
	}).join("\n");
	return `请对以下导入的数据进行分析,完成知识抽取与分类,并生成一份知识条目草稿。严格用以下 Markdown 结构输出:

# 标题:<简短标题>
- 分类:<建议分类,如:标准规范 / 工艺知识 / 品质案例 / 工程案例 / 设备维护>
- 标签:<3-5个标签,逗号分隔>
- 摘要:<一句话概括>
- 版本:<v1.0,或从数据中识别>
- 有效期:<YYYY-MM-DD ~ YYYY-MM-DD,长期有效留空>
- 适用范围:<如:全厂 / 电镀工序 / 成型>
- 权限:<all 或 quality,engineering,equipment 的组合>
- 依据标准:<如 IPC-6012,没有则留空>

## 正文
<结构化知识内容,包含关键信息与要点>

来源文件:${fileName}
数据列:${headers.join(", ")}
数据内容(前30行):
${preview}`;
}

// —— 交付物(清单/报告/对比结果) ——
function listArtifacts() {
	try {
		return readdirSync(ARTIFACT_DIR)
			.filter((f) => f.endsWith(".md"))
			.map((f) => {
				let title = f;
				try {
					const content = readFileSync(join(ARTIFACT_DIR, f), "utf-8");
					const m = content.match(/^#\s*(.+)$/m);
					if (m) title = m[1].trim();
				} catch {}
				return { id: f, title, url: "/api/artifacts/" + f };
			})
			.sort((a, b) => b.id.localeCompare(a.id));
	} catch {
		return [];
	}
}

// —— 行级差异对比(LCS) ——
function diffLines(a, b) {
	const al = String(a || "").split("\n");
	const bl = String(b || "").split("\n");
	const n = al.length, m = bl.length;
	const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const out = [];
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (al[i] === bl[j]) { out.push({ type: "same", text: al[i] }); i++; j++; }
		else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: al[i] }); i++; }
		else { out.push({ type: "add", text: bl[j] }); j++; }
	}
	while (i < n) { out.push({ type: "del", text: al[i] }); i++; }
	while (j < m) { out.push({ type: "add", text: bl[j] }); j++; }
	const stats = { add: 0, del: 0, same: 0 };
	for (const d of out) stats[d.type]++;
	return { diff: out, stats };
}

const server = http.createServer(async (req, res) => {
	const urlPath = (req.url || "/").split("?")[0];

	// 历史记录 API
	if (urlPath === "/api/history") {
		const url = new URL(req.url, "http://localhost");
		const id = url.searchParams.get("id");
		if (req.method === "DELETE") {
			if (id) {
				try { unlinkSync(join(HISTORY_DIR, id + ".json")); } catch {}
			} else {
				readdirSync(HISTORY_DIR).forEach((f) => { if (f.endsWith(".json")) { try { unlinkSync(join(HISTORY_DIR, f)); } catch {} } });
			}
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: true }));
		} else {
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(id ? loadHistory(id) || { error: "not found" } : listHistory()));
		}
		return;
	}

	// 注册
	if (urlPath === "/api/register" && req.method === "POST") {
		const body = await readBody(req);
		const phone = String(body.phone || "").trim();
		const password = String(body.password || "");
		const department = String(body.department || "").trim();
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		if (!/^1\d{10}$/.test(phone)) { res.end(JSON.stringify({ error: "手机号格式不正确" })); return; }
		if (password.length < 6) { res.end(JSON.stringify({ error: "密码至少 6 位" })); return; }
		if (db.prepare("SELECT id FROM users WHERE phone = ?").get(phone)) { res.end(JSON.stringify({ error: "该手机号已注册,请直接登录" })); return; }
		db.prepare("INSERT INTO users (phone, password, department, created_at) VALUES (?, ?, ?, ?)").run(phone, hashPwd(phone, password), department, new Date().toISOString());
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	// 登录
	if (urlPath === "/api/login" && req.method === "POST") {
		const body = await readBody(req);
		const phone = String(body.phone || "").trim();
		const password = String(body.password || "");
		const user = db.prepare("SELECT id, phone, password, department FROM users WHERE phone = ?").get(phone);
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		if (!user || user.password !== hashPwd(phone, password)) { res.end(JSON.stringify({ error: "手机号或密码错误" })); return; }
		const token = randomBytes(16).toString("hex");
		tokens.set(token, user.id);
		res.end(JSON.stringify({ token, user: { id: user.id, phone: user.phone, department: user.department } }));
		return;
	}

	// 当前登录用户
	if (urlPath === "/api/me") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(getAuthUser(req) || null));
		return;
	}

	// 专家角色列表
	if (urlPath === "/api/roles") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(EXPERT_ROLES));
		return;
	}

	// 知识治理分析(过期 / 即将过期 / 重复 / 无版本)
	if (urlPath === "/api/governance") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(governanceReport(db)));
		return;
	}

	// 客诉列表 API
	if (urlPath === "/api/complaints") {
		const url = new URL(req.url, "http://localhost");
		const id = url.searchParams.get("id");
		let rows;
		if (id) {
			rows = db.prepare("SELECT * FROM complaints WHERE id = ?").all(Number(id));
		} else {
			rows = db.prepare("SELECT * FROM complaints ORDER BY close_date DESC").all();
		}
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(rows));
		return;
	}

	// 文件上传解析(知识录入)
	if (urlPath === "/api/upload" && req.method === "POST") {
		try {
			const body = await readBody(req);
			const buf = Buffer.from(body.content || "", "base64");
			const name = body.fileName || "file";
			let wb;
			if (/\.csv$/i.test(name)) {
				wb = XLSX.read(buf.toString("utf-8"), { type: "string" });
			} else {
				wb = XLSX.read(buf, { type: "buffer" });
			}
			const sheet = wb.Sheets[wb.SheetNames[0]];
			for (const m of sheet["!merges"] || []) {
				const v = sheet[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })]?.v;
				if (v !== undefined && v !== null) {
					for (let r = m.s.r; r <= m.e.r; r++) {
						for (let c = m.s.c; c <= m.e.c; c++) {
							const addr = XLSX.utils.encode_cell({ r, c });
							if (!sheet[addr]) sheet[addr] = { t: "s", v };
							else if (sheet[addr].v === undefined || sheet[addr].v === null) sheet[addr].v = v;
						}
					}
				}
			}
			const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
			const headers = (data[0] || []).map((h) => String(h));
			const rows = data.slice(1).filter((r) => r.some((c) => c !== "" && c !== undefined && c !== null));
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ fileName: name, headers, rows: rows.slice(0, 80), totalRows: rows.length }));
		} catch (err) {
			res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: "解析失败: " + (err.message || err) }));
		}
		return;
	}

	// 知识库(含版本/有效期/适用范围/权限/依据标准)
	if (urlPath === "/api/knowledge") {
		if (req.method === "POST") {
			const body = await readBody(req);
			const now = new Date().toISOString();
			if (body.id) {
				db.prepare(`UPDATE knowledge SET title=?, category=?, tags=?, summary=?, content=?, source=?, version=?, valid_from=?, valid_to=?, scope=?, permission=?, status=?, standard_ref=?, updated_at=? WHERE id=?`).run(
					body.title || "", body.category || "", body.tags || "", body.summary || "", body.content || "", body.source || "",
					body.version || "1.0", body.valid_from || null, body.valid_to || null, body.scope || "全厂",
					body.permission || "all", body.status || "approved", body.standard_ref || null, now, Number(body.id),
				);
			} else {
				db.prepare(`INSERT INTO knowledge (title, category, tags, summary, content, source, created_at, version, valid_from, valid_to, scope, permission, status, standard_ref, author, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
					body.title || "", body.category || "", body.tags || "", body.summary || "", body.content || "", body.source || "", now,
					body.version || "1.0", body.valid_from || null, body.valid_to || null, body.scope || "全厂",
					body.permission || "all", body.status || "approved", body.standard_ref || null, body.author || "", now,
				);
			}
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: true }));
		} else if (req.method === "DELETE") {
			const id = Number(new URL(req.url, "http://localhost").searchParams.get("id"));
			if (id) db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: true }));
		} else {
			const rows = db.prepare("SELECT * FROM knowledge ORDER BY id DESC").all();
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(rows));
		}
		return;
	}

	// 知识状态(归档/恢复)
	if (urlPath === "/api/knowledge/status" && req.method === "POST") {
		const body = await readBody(req);
		db.prepare("UPDATE knowledge SET status = ? WHERE id = ?").run(body.status || "approved", Number(body.id));
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	// 经验沉淀:提交 / 列表
	if (urlPath === "/api/experience") {
		const url = new URL(req.url, "http://localhost");
		if (req.method === "POST") {
			const body = await readBody(req);
			const user = getAuthUser(req);
			db.prepare(`INSERT INTO experience (title, category, tags, summary, content, source, author, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
				body.title || "", body.category || "", body.tags || "", body.summary || "", body.content || "", body.source || "",
				user ? user.department || user.phone : "匿名", new Date().toISOString(),
			);
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: true }));
		} else {
			const status = url.searchParams.get("status");
			const rows = status
				? db.prepare("SELECT * FROM experience WHERE status = ? ORDER BY id DESC").all(status)
				: db.prepare("SELECT * FROM experience ORDER BY id DESC").all();
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(rows));
		}
		return;
	}

	// 经验审核:通过 → 存回知识库;驳回 → 标记
	if (urlPath === "/api/experience/review" && req.method === "POST") {
		const body = await readBody(req);
		const user = getAuthUser(req);
		const reviewer = user ? user.department || user.phone : "审核人";
		const row = db.prepare("SELECT * FROM experience WHERE id = ?").get(Number(body.id));
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		if (!row) { res.end(JSON.stringify({ error: "记录不存在" })); return; }
		if (body.action === "approve") {
			const now = new Date().toISOString();
			db.prepare(`INSERT INTO knowledge (title, category, tags, summary, content, source, created_at, version, valid_from, valid_to, scope, permission, status, standard_ref, author, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '1.0', NULL, NULL, '全厂', 'all', 'approved', NULL, ?, ?)`).run(
				row.title, row.category, row.tags, row.summary, row.content, row.source || "经验沉淀", now, row.author || "", now,
			);
			db.prepare("UPDATE experience SET status = 'approved', reviewer = ?, reviewed_at = ?, review_comment = ? WHERE id = ?").run(reviewer, now, body.comment || "审核通过,已入库", Number(body.id));
		} else {
			db.prepare("UPDATE experience SET status = 'rejected', reviewer = ?, reviewed_at = ?, review_comment = ? WHERE id = ?").run(reviewer, new Date().toISOString(), body.comment || "已驳回", Number(body.id));
		}
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	// 交付物:列表 / 下载
	if (urlPath === "/api/artifacts") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(listArtifacts()));
		return;
	}
	if (urlPath.startsWith("/api/artifacts/")) {
		const file = normalize(urlPath.slice("/api/artifacts/".length)).replace(/^(\.\.(\/|\\|$))+/, "");
		if (!/^[0-9a-zA-Z\-._]+\.md$/.test(file)) {
			res.writeHead(403); res.end("Forbidden"); return;
		}
		try {
			const content = readFileSync(join(ARTIFACT_DIR, file), "utf-8");
			res.writeHead(200, { "Content-Type": MIME[".md"], "Content-Disposition": `attachment; filename="${encodeURIComponent(file)}"` });
			res.end(content);
		} catch {
			res.writeHead(404); res.end("404 Not Found");
		}
		return;
	}

	// 文件对比
	if (urlPath === "/api/compare" && req.method === "POST") {
		const body = await readBody(req);
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(diffLines(body.a || "", body.b || "")));
		return;
	}

	// 知识草稿生成
	if (urlPath === "/api/draft" && req.method === "POST") {
		try {
			const body = await readBody(req);
			const prompt = buildDraftPrompt(body.fileName || "file", body.headers || [], body.rows || []);
			let full = "";
			const unsub = session.subscribe((event) => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					full += event.assistantMessageEvent.delta;
				}
			});
			await session.prompt(prompt);
			unsub();
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ draft: full }));
		} catch (err) {
			res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: err.message || String(err) }));
		}
		return;
	}

	// 静态文件
	const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
	const filePath = normalize(join(__dirname, "../public", rel));
	if (!filePath.startsWith(normalize(join(__dirname, "../public")))) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}
	try {
		const content = readFileSync(filePath);
		const ext = filePath.slice(filePath.lastIndexOf("."));
		res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
		res.end(content);
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("404 Not Found");
	}
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
	activeWs = ws;
	ws.send(JSON.stringify({ type: "ready", model: `${model.provider}/${model.id}` }));

	ws.on("message", async (raw) => {
		let msg;
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			return;
		}
		if (msg.type !== "ask" || !msg.text) return;

		// 更新专家模式并注入提示
		currentRole = ["quality", "engineering", "equipment", "general"].includes(msg.role) ? msg.role : "general";
		const roleName = getRole(currentRole).name;
		const prompt = currentRole === "general" ? msg.text : `[当前专家模式:${roleName}] 请以「${roleName}」身份回答,优先检索知识库并引用有效标准与历史案例。\n\n${msg.text}`;

		current = { userText: msg.text, segments: [] };

		const unsubscribe = session.subscribe((event) => {
			if (event.type !== "message_update") return;
			const e = event.assistantMessageEvent;
			if (e.type === "text_delta" && e.delta) {
				const last = current.segments[current.segments.length - 1];
				if (last && last.type === "text") last.text += e.delta;
				else current.segments.push({ type: "text", text: e.delta });
				broadcast({ type: "delta", text: e.delta });
			} else if (e.type === "toolcall_start") {
				broadcast({ type: "tool_start" });
			} else if (e.type === "toolcall_end") {
				broadcast({ type: "tool_end" });
			}
		});

		try {
			await session.prompt(prompt);
			saveHistory();
			broadcast({ type: "done" });
		} catch (err) {
			broadcast({ type: "error", message: err?.message || String(err) });
		} finally {
			unsubscribe();
		}
	});

	ws.on("close", () => {
		if (activeWs === ws) activeWs = null;
	});
});

server.listen(PORT, () => {
	console.log(`✅ 平台已启动,浏览器打开: http://localhost:${PORT}`);
	console.log("   关闭服务请按 Ctrl+C\n");
});
