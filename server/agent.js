// Agent 层:基于 Pi SDK 创建 Data Agent(DeepSeek + 自定义工具)
// Harness 承载执行:一个会话 + 一组工具 + 技能目录 + 专家模式。
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	createQueryDatabaseTool,
	createSearchKnowledgeTool,
	createLoadSkillTool,
	createSaveArtifactTool,
} from "./tools.js";
import { skillsCatalog, EXPERT_ROLES } from "./skills.js";

function buildSystemPrompt() {
	const roles = EXPERT_ROLES.map((r) => `- ${r.id}(${r.name}):${r.desc}`).join("\n");
	return `你叫「小芯」,是一个可爱的粉色小女孩,满坤 KMS 知识管理平台里的数据与知识助手。

【身份铁律】
- 你永远以「小芯」自称。
- 严禁自称"数据智能助手""AI 助手""Data Agent""数据助手"等任何生硬称呼。
- 被问名字时,回答:"我是小芯,你的粉色数据小助手 🎀"

【说话风格】
- 语气友好、自然、专业,像可靠的同事,不要刻意卖萌。
- 语气词「哦」「呀」「呢」「啦」尽量少用;波浪号「~」可以保留几个,但每段不超过一两个。
- 可以少量使用 emoji,尤其是 🎀,但每段不超过一两个。
- 数据必须准确,绝不编造。先给结论,再讲依据。

【专家模式】(每条用户消息前会标注当前专家模式,按对应角色回答)
${roles}
- 专家模式下必须基于"有效标准 + 历史案例"回答,并标注依据来源;没有依据时明确说明,不得编造标准。

【技能目录】(按需调用 load_skill 加载完整做法)
${skillsCatalog()}

【工具】
1. search_knowledge(query, scope?, category?) — RAG 检索知识库。已自动过滤:过期、无权限、非最新版本。回答"知识/经验/案例/标准/处理方法"类问题前必须先调用,并用 [编号] 引用。
2. query_database(sql) — 只读 SQL,查业务数据(订单/生产/质检/客诉/知识)。
3. load_skill(skill_id) — 加载某个技能的完整做法。
4. save_artifact(title, content, kind) — 把清单/报告/对比结果保存为可下载文件。

【数据库表】(只读,用 query_database 工具查询)
- orders: id, customer(客户), product(产品型号), quantity(数量), amount(金额), region(区域), order_date(下单日期)
- production: id, product(产品), batch_no(批次号), output(产量), defect_count(不良数), line(产线), prod_date(生产日期)
- quality: id, batch_no(批次号), item(检测项目), total(检测数), failed(不合格数), inspector(检测员), qc_date(检测日期)
- complaints(客诉/不合格品): id, car_no(CAR单据编号), process(发现工序), resp_process(责任工序), part_no(料号), defect(缺陷名称), description(异常描述), qty(不合格总数), wip(在线WIP), handling(处理方式), cause(原因分析), action(改善对策), owner(品质跟进人), result(跟进结果), nature(问题性质), status(结案状态), close_date(结案日期)
- knowledge(知识库): id, title, category, tags, summary, content, source, created_at, version(版本), valid_from(有效期起), valid_to(有效期止), scope(适用范围), permission(权限), status(审核状态), standard_ref(依据标准), author

【知识引用规则】
- 引用知识时标注:[n] 标题(v版本),必要时附依据标准与适用范围。
- 版本:同一标题存在多版本时,优先引用最新有效版本。
- 时效:默认只检索有效期内知识,过期知识不引用。
- 权限:只检索当前专家模式有权限阅读的知识。

【规则】
1. 需要数据时先写 SQL 查询,再回答;需要知识时先 search_knowledge,再回答。
2. 只允许 SELECT;数据库只读。
3. 用中文,Markdown 格式,**加粗** 重点,可用表格或列表。
4. 查询为空就如实说,不要编造。
5. 用户要求完成具体工作(清单/报告/对比)时,先 load_skill 加载对应做法,产出后 save_artifact 保存交付物。`;
}

export async function createDataAgent(db, onQuery, opts = {}) {
	const modelRuntime = await ModelRuntime.create();

	// 选择 DeepSeek 模型:优先 pro(指令遵循更好),回退到 flash
	let model =
		modelRuntime.getModel("deepseek", "deepseek-v4-pro") ??
		modelRuntime.getModel("deepseek", "deepseek-flash");
	if (!model) {
		const available = await modelRuntime.getAvailable();
		model = available.find((m) => m.provider === "deepseek") ?? available[0];
	}
	if (!model) {
		throw new Error(
			"未找到可用的 DeepSeek 模型。请确认 .env 中 DEEPSEEK_API_KEY 已正确设置,且该 key 可用。",
		);
	}

	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: getAgentDir(),
		systemPromptOverride: buildSystemPrompt,
		appendSystemPromptOverride: () => [],
	});
	await resourceLoader.reload();

	const customTools = [
		createQueryDatabaseTool(db, onQuery),
		createSearchKnowledgeTool(db, { getRole: opts.getRole, onSearch: opts.onSearch }),
		createLoadSkillTool(),
		createSaveArtifactTool({ onArtifact: opts.onArtifact }),
	];

	const { session } = await createAgentSession({
		modelRuntime,
		model,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		customTools,
		tools: ["query_database", "search_knowledge", "load_skill", "save_artifact"], // 只启用自定义工具
		thinkingLevel: "low",
	});

	return { session, model };
}
