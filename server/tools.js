// 自定义工具层:向 Pi Agent 注册"查询数据库"工具
import { Type } from "typebox";

const MAX_ROWS = 500;

/**
 * 创建 query_database 工具
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {(payload: { sql: string; rows: object[]; count: number }) => void} [onQuery] 查询回调(用于推送前端展示)
 */
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
				if (onQuery) {
					onQuery({ sql, rows: slice, count });
				}
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
