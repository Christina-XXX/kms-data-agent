// 自定义工具层:向 Pi Agent 注册工具(实际操作)
// Harness(Agent 会话)承载执行,Skills 定义做法,工具负责真正动手。
import { Type } from "typebox";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { searchKnowledge, formatResults } from "./rag.js";
import { getSkill } from "./skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_ROWS = 500;
const ARTIFACT_DIR = join(__dirname, "../data/artifacts");
mkdirSync(ARTIFACT_DIR, { recursive: true });

/** query_database:只读 SQL 查询 */
export function createQueryDatabaseTool(db, onQuery) {
	return {
		name: "query_database",
		label: "查询数据库",
		description:
			"在企业的业务数据库(SQLite)中执行一条只读 SQL 查询。当用户的问题需要用数据支撑时,先调用本工具查询,再基于返回结果作答。只支持 SELECT 查询。",
		promptSnippet: "query_database(sql) - 执行只读 SQL 查询,返回结果集",
		parameters: Type.Object({
			sql: Type.String({ description: "要执行的 SELECT 查询语句" }),
		}),
		async execute(_toolCallId, params) {
			const sql = String(params.sql || "").trim();
			if (!/^(select|with)\b/i.test(sql)) {
				return {
					content: [{ type: "text", text: "错误:只允许 SELECT 查询,数据库是只读的。" }],
					details: {},
				};
			}
			try {
				const rows = db.prepare(sql).all();
				const count = rows.length;
				const slice = rows.slice(0, MAX_ROWS);
				if (onQuery) onQuery({ sql, rows: slice, count });
				const text =
					JSON.stringify(slice) +
					(count > MAX_ROWS ? `\n...(结果共 ${count} 行,已截断前 ${MAX_ROWS} 行)` : "");
				return {
					content: [{ type: "text", text: `查询到 ${count} 行结果:\n${text}` }],
					details: {},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `SQL 执行出错: ${err.message}` }],
					details: {},
				};
			}
		},
	};
}

/** search_knowledge:RAG 检索(版本/有效期/适用范围/权限已过滤) */
export function createSearchKnowledgeTool(db, { getRole, onSearch } = {}) {
	return {
		name: "search_knowledge",
		label: "检索知识库",
		description:
			"在知识库中检索相关资料(向量级语义 + 关键词召回,自动过滤过期、无权限、非当前版本的知识)。回答'知识/经验/案例/标准/处理方法'类问题前应先调用本工具,引用返回的 [编号] 与依据,不要凭空回答。",
		promptSnippet: "search_knowledge(query, scope?, category?) - 检索知识库并返回带引用编号的片段",
		parameters: Type.Object({
			query: Type.String({ description: "检索关键词或问题,如:面铜偏薄 处置" }),
			scope: Type.Optional(Type.String({ description: "适用范围过滤,如:电镀工序、成型、全厂" })),
			category: Type.Optional(Type.String({ description: "分类过滤,如:品质案例、工艺知识、标准规范" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const role = typeof getRole === "function" ? getRole() : "general";
				const results = searchKnowledge(db, String(params.query || ""), {
					role,
					scope: params.scope || "",
					category: params.category || "",
					limit: 5,
				});
				if (onSearch) onSearch(results);
				return {
					content: [{ type: "text", text: formatResults(results) || "未检索到相关知识。" }],
					details: {},
				};
			} catch (err) {
				return { content: [{ type: "text", text: `检索出错: ${err.message}` }], details: {} };
			}
		},
	};
}

/** load_skill:按需加载 Skill 的完整做法 */
export function createLoadSkillTool() {
	return {
		name: "load_skill",
		label: "加载技能做法",
		description:
			"加载某个 Skill 的完整操作说明(做法)。当任务命中某个技能且需要其详细步骤时调用。可用技能见系统提示中的技能目录。",
		promptSnippet: "load_skill(skill_id) - 返回技能的完整做法说明",
		parameters: Type.Object({
			skill_id: Type.String({ description: "技能 id,如 expert-answer / checklist / report-8d / experience-consolidation" }),
		}),
		async execute(_toolCallId, params) {
			const skill = getSkill(String(params.skill_id || ""));
			if (!skill) {
				return {
					content: [{ type: "text", text: "未找到该技能,请从系统提示的技能目录中选择有效 id。" }],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: `技能「${skill.name}」做法:\n${skill.instructions}` }],
				details: {},
			};
		},
	};
}

/** save_artifact:把生成的清单/报告/对比结果保存为可下载文件 */
export function createSaveArtifactTool({ onArtifact } = {}) {
	return {
		name: "save_artifact",
		label: "保存交付物",
		description:
			"把生成的清单(checklist)、报告(report)、对比结果(comparison)等交付物保存为 Markdown 文件,返回下载链接,方便用户下载使用。",
		promptSnippet: "save_artifact(title, content, kind) - 保存交付物并返回下载链接",
		parameters: Type.Object({
			title: Type.String({ description: "交付物标题,如:电镀线开线点检清单" }),
			content: Type.String({ description: "交付物 Markdown 正文" }),
			kind: Type.Optional(Type.String({ description: "类型:checklist / report / comparison / note,默认 note" })),
		}),
		async execute(_toolCallId, params) {
			try {
				const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const title = String(params.title || "未命名交付物").slice(0, 80);
				const kind = String(params.kind || "note");
				const content = String(params.content || "");
				const fileName = `${id}.md`;
				writeFileSync(
					join(ARTIFACT_DIR, fileName),
					`# ${title}\n\n> 类型:${kind} · 生成时间:${new Date().toLocaleString("zh-CN")}\n\n${content}`,
					"utf-8",
				);
				const url = `/api/artifacts/${fileName}`;
				if (onArtifact) onArtifact({ id, title, kind, url });
				return {
					content: [{ type: "text", text: `已保存交付物「${title}」,下载链接:${url}` }],
					details: {},
				};
			} catch (err) {
				return { content: [{ type: "text", text: `保存失败: ${err.message}` }], details: {} };
			}
		},
	};
}
