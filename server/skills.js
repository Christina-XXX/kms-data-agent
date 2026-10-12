// Skills 定义层:每个 Skill 定义"怎么做"(做法),工具层负责"实际操作"
// 系统提示只注入目录(name/description/when),模型按需通过 load_skill 工具加载完整做法。

export const EXPERT_ROLES = [
	{
		id: "general",
		name: "通用助手",
		emoji: "🎀",
		desc: "默认模式,回答全厂公开知识、数据查询与日常问题。",
	},
	{
		id: "quality",
		name: "品质专家",
		emoji: "🔍",
		desc: "按有效标准(IPC-6012/IPC-A-600/客户图纸)判定缺陷、给出处置与预防,附历史案例与依据。",
	},
	{
		id: "engineering",
		name: "工程专家",
		emoji: "🛠",
		desc: "面向工艺/工程,给出参数控制、根因分析与改善对策,附工艺标准与历史案例。",
	},
	{
		id: "equipment",
		name: "设备专家",
		emoji: "⚙️",
		desc: "面向设备维护,给出点检、保养、异常处置与耗材管理建议,附设备规范与案例。",
	},
];

export const SKILLS = [
	{
		id: "expert-answer",
		name: "专家问答",
		description: "以专业角色回答品质/工程/设备问题,必须检索知识库,引用有效标准与历史案例并标注依据。",
		when: "用户以专家模式提问、要求判定缺陷、分析根因、给出依据或标准时。",
		instructions: `【专家问答做法】
1. 先确认当前专家模式(品质/工程/设备/通用)。
2. 调用 search_knowledge 检索有效知识(权限、有效期、版本已自动过滤)。
3. 需要数据佐证时调用 query_database(如客诉、质检、生产数据)。
4. 回答结构:
   - 结论(先给判定/建议)
   - 依据标准(引用 standard_ref,如 IPC-6012 §3.6.2)
   - 历史案例(引用同类客诉/经验,标注 CAR 编号)
   - 处置与预防措施
5. 引用格式:[1] 标题(v版本)。没有检索到依据时,明确说"知识库暂无有效依据",不得编造标准。`,
	},
	{
		id: "experience-consolidation",
		name: "经验整理",
		description: "把一次问题处理过程整理成结构化经验条目,供人工审核后入库沉淀。",
		when: "用户说'沉淀经验/整理经验/总结这次问题处理'时。",
		instructions: `【经验整理做法】
1. 引导用户补充 6 要素:背景、现象、根因、处理措施、效果验证、预防措施(信息足够则跳过追问)。
2. 输出结构化 Markdown:
   # 标题:<缺陷/问题 + 处置,一句话>
   - 分类:品质案例 / 工程案例 / 设备案例 / 工艺知识
   - 标签:3-5 个
   - 摘要:一句话
   ## 背景 / 现象 / 根因 / 处理措施 / 效果验证 / 预防措施
3. 提示用户:确认后走"审核入库"流程(人确认 → 审核 → 存回知识库)。`,
	},
	{
		id: "checklist",
		name: "清单生成",
		description: "把任务拆解为可勾选的检查清单/工作清单,并保存为可下载交付物。",
		when: "用户要求'做个清单/检查表/checklist/列出步骤'时。",
		instructions: `【清单生成做法】
1. 明确任务目标与适用对象(工序/设备/场景)。
2. 拆解为可执行、可勾选的条目,按阶段分组(准备/执行/确认/收尾)。
3. 每个条目:动作 + 标准/数量/责任人(可留空待填)。
4. 输出 Markdown 后调用 save_artifact(kind='checklist') 保存为下载文件。`,
	},
	{
		id: "report-8d",
		name: "8D 报告",
		description: "按 D1-D8 八步法生成客诉 8D 报告。",
		when: "用户要求生成 8D 报告或对客诉做结构化整改时。",
		instructions: `【8D 报告做法】
按 D1 团队组建、D2 问题描述、D3 临时措施、D4 根本原因、D5 永久纠正措施、D6 验证、D7 预防再发、D8 总结输出。
依据客诉记录(可先 query_database 查 complaints),必要时 save_artifact 保存。`,
	},
	{
		id: "report-fa",
		name: "FA 失效分析",
		description: "对失效件做失效现象、机理、根因、验证与改进建议分析。",
		when: "用户要求做 FA 失效分析时。",
		instructions: `【FA 失效分析做法】
输出:失效现象 → 失效机理 → 失效根因 → 验证方法 → 改进建议。
优先检索知识库同类案例,引用依据标准。`,
	},
	{
		id: "file-compare-analysis",
		name: "文件比较分析",
		description: "对两份文档/清单/报表的差异做结构化分析,输出变更点与影响。",
		when: "用户提供两份文件对比结果或要求分析差异时。",
		instructions: `【文件比较分析做法】
1. 识别新增/删除/修改内容。
2. 分类:数值变更、条款变更、范围变更、格式变更。
3. 评估影响(品质/工艺/设备)并给建议。
4. 用表格呈现差异,附建议。`,
	},
	{
		id: "knowledge-curation",
		name: "知识整理入库",
		description: "对导入的数据抽取、分类、打标签并生成知识草稿,供确认入库。",
		when: "知识录入、上传文件后生成草稿时。",
		instructions: `【知识整理入库做法】
1. 提取主题、分类、标签、摘要。
2. 保留版本、有效期、适用范围、权限、依据标准字段(能识别时给出建议值)。
3. 输出结构化 Markdown 草稿。`,
	},
];

export function skillsCatalog() {
	return SKILLS.map((s) => `- ${s.id}:${s.description}(适用于:${s.when})`).join("\n");
}

export function getSkill(id) {
	return SKILLS.find((s) => s.id === id) || null;
}

export function getRole(id) {
	return EXPERT_ROLES.find((r) => r.id === id) || EXPERT_ROLES[0];
}
