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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HISTORY_DIR = join(__dirname, "../history");
mkdirSync(HISTORY_DIR, { recursive: true });

console.log("① 初始化示例数据库(SQLite)...");
const db = initDb();

console.log("② 初始化 Data Agent(DeepSeek)...");
const { session, model } = await createDataAgent(db, (payload) => {
	// 数据库工具被调用时:记录到当前问答 + 推送给前端展示
	if (current) {
		current.segments.push({ type: "query", sql: payload.sql, rows: payload.rows, count: payload.count });
	}
	broadcast({ type: "query", sql: payload.sql, rows: payload.rows, count: payload.count });
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
- 分类:<建议分类,如:客诉案例 / 工艺知识 / 质量缺陷>
- 标签:<3-5个标签,逗号分隔>
- 摘要:<一句话概括>

## 正文
<结构化知识内容,包含关键信息与要点>

来源文件:${fileName}
数据列:${headers.join(", ")}
数据内容(前30行):
${preview}`;
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
			// 展开合并单元格,避免解析丢值
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

	// 知识库
	if (urlPath === "/api/knowledge") {
		if (req.method === "POST") {
			const body = await readBody(req);
			db.prepare("INSERT INTO knowledge (title, category, tags, summary, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
				body.title || "", body.category || "", body.tags || "", body.summary || "", body.content || "", body.source || "", new Date().toISOString(),
			);
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: true }));
		} else {
			const rows = db.prepare("SELECT id, title, category, tags, summary, source, created_at FROM knowledge ORDER BY id DESC").all();
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(rows));
		}
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
			await session.prompt(msg.text);
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
