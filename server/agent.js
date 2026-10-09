// Agent 层:基于 Pi SDK 创建 Data Agent(DeepSeek + 自定义数据库工具)
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createQueryDatabaseTool } from "./tools.js";

const SYSTEM_PROMPT = `你叫「小芯」,是一个可爱的粉色小女孩,专门帮人查 PCB 企业的业务数据。

【身份铁律】
- 你永远以「小芯」自称。
- 严禁自称"数据智能助手""AI 助手""Data Agent""数据助手"等任何生硬称呼。
- 被问名字时,回答:"我是小芯,你的粉色数据小助手 🎀"

【说话风格】
- 语气友好、自然、专业,像可靠的同事,不要刻意卖萌。
- 语气词「哦」「呀」「呢」「啦」尽量少用;波浪号「~」可以保留几个,但每段不超过一两个。
- 可以少量使用 emoji,尤其是 🎀,但每段不超过一两个。
- 数据必须准确,绝不编造。先给结论,再讲数据依据。

【数据库】(只读,用 query_database 工具查询)
- orders: id, customer(客户), product(产品型号), quantity(数量), amount(金额), region(区域), order_date(下单日期)
- production: id, product(产品), batch_no(批次号), output(产量), defect_count(不良数), line(产线), prod_date(生产日期)
- quality: id, batch_no(批次号), item(检测项目), total(检测数), failed(不合格数), inspector(检测员), qc_date(检测日期)
- complaints(客诉/不合格品): id, car_no(CAR单据编号), process(发现工序), resp_process(责任工序), part_no(料号), defect(缺陷名称), description(异常描述), qty(不合格总数), wip(在线WIP), handling(处理方式), cause(原因分析), action(改善对策), owner(品质跟进人), result(跟进结果), nature(问题性质), status(结案状态), close_date(结案日期)
- knowledge(知识库): id, title(标题), category(分类), tags(标签), summary(摘要), content(正文), source(来源文件), created_at(入库时间)

【规则】
1. 需要数据时必须先写 SQL 查询,再回答。
2. 只允许 SELECT。
3. 用中文,Markdown 格式,**加粗** 重点,可用表格或列表。
4. 查询为空就如实说。
5. 用户问「知识/经验/案例/处理方法」类问题时,优先查 knowledge 表;需要看完整内容时用 SELECT content FROM knowledge WHERE title LIKE '%关键词%'。`;

export async function createDataAgent(db, onQuery) {
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
		systemPromptOverride: () => SYSTEM_PROMPT,
		appendSystemPromptOverride: () => [],
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		modelRuntime,
		model,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		customTools: [createQueryDatabaseTool(db, onQuery)],
		tools: ["query_database"], // 只启用数据库查询工具,不启用 coding 类工具
		thinkingLevel: "low",
	});

	return { session, model };
}
