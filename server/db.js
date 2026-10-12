// 数据库层:持久化 SQLite,首次启动预置 PCB 示例数据
// 后期对接企业真实数据时,只需替换这里的初始化逻辑
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../data/data.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

/** 给旧库补列(表名/列名均为内部硬编码,非用户输入,插值安全) */
function ensureColumn(db, table, column, ddl) {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all();
	if (!cols.some((c) => c.name === column)) {
		db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
	}
}

export function initDb() {
	const db = new DatabaseSync(DB_PATH);

	db.exec(`
		CREATE TABLE IF NOT EXISTS orders (
			id INTEGER PRIMARY KEY,
			customer TEXT,
			product TEXT,
			quantity INTEGER,
			amount REAL,
			region TEXT,
			order_date TEXT
		);
		CREATE TABLE IF NOT EXISTS production (
			id INTEGER PRIMARY KEY,
			product TEXT,
			batch_no TEXT,
			output INTEGER,
			defect_count INTEGER,
			line TEXT,
			prod_date TEXT
		);
		CREATE TABLE IF NOT EXISTS quality (
			id INTEGER PRIMARY KEY,
			batch_no TEXT,
			item TEXT,
			total INTEGER,
			failed INTEGER,
			inspector TEXT,
			qc_date TEXT
		);
		CREATE TABLE IF NOT EXISTS complaints (
			id INTEGER PRIMARY KEY,
			car_no TEXT,
			process TEXT,
			resp_process TEXT,
			part_no TEXT,
			defect TEXT,
			description TEXT,
			qty TEXT,
			wip TEXT,
			handling TEXT,
			cause TEXT,
			action TEXT,
			owner TEXT,
			result TEXT,
			nature TEXT,
			status TEXT,
			close_date TEXT
		);
		CREATE TABLE IF NOT EXISTS knowledge (
			id INTEGER PRIMARY KEY,
			title TEXT,
			category TEXT,
			tags TEXT,
			summary TEXT,
			content TEXT,
			source TEXT,
			created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY,
			phone TEXT UNIQUE,
			password TEXT,
			department TEXT,
			created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS experience (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT,
			category TEXT,
			tags TEXT,
			summary TEXT,
			content TEXT,
			source TEXT,
			author TEXT,
			status TEXT DEFAULT 'pending',
			review_comment TEXT,
			reviewer TEXT,
			created_at TEXT,
			reviewed_at TEXT
		);
	`);

	// —— 知识库治理字段迁移(版本 / 有效期 / 适用范围 / 权限 / 审核状态 / 依据标准) ——
	// 修复早期版本迁移可能误加的坏列(列名被解析为类型关键字)
	const kcols = db.prepare("PRAGMA table_info(knowledge)").all().map((c) => c.name);
	if (kcols.includes("TEXT")) db.exec('ALTER TABLE knowledge DROP COLUMN "TEXT"');
	ensureColumn(db, "knowledge", "version", "TEXT DEFAULT '1.0'");
	ensureColumn(db, "knowledge", "valid_from", "TEXT");
	ensureColumn(db, "knowledge", "valid_to", "TEXT");
	ensureColumn(db, "knowledge", "scope", "TEXT DEFAULT '全厂'");
	ensureColumn(db, "knowledge", "permission", "TEXT DEFAULT 'all'");
	ensureColumn(db, "knowledge", "status", "TEXT DEFAULT 'approved'");
	ensureColumn(db, "knowledge", "standard_ref", "TEXT");
	ensureColumn(db, "knowledge", "author", "TEXT");
	ensureColumn(db, "knowledge", "updated_at", "TEXT");

	// 示例数据只在首次初始化时插入
	const existing = db.prepare("SELECT COUNT(*) AS c FROM orders").get();
	if (existing.c === 0) {
		insertSampleData(db);
	}

	// 知识库为空时,预置带「版本/有效期/适用范围/权限/依据标准」的示例知识
	const kc = db.prepare("SELECT COUNT(*) AS c FROM knowledge").get();
	if (kc.c === 0) {
		insertSampleKnowledge(db);
	}

	return db;
}

function insertSampleData(db) {
	const insertOrder = db.prepare(
		"INSERT INTO orders (customer, product, quantity, amount, region, order_date) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const insertProd = db.prepare(
		"INSERT INTO production (product, batch_no, output, defect_count, line, prod_date) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const insertQuality = db.prepare(
		"INSERT INTO quality (batch_no, item, total, failed, inspector, qc_date) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const insertComplaint = db.prepare(
		"INSERT INTO complaints (car_no, process, resp_process, part_no, defect, description, qty, wip, handling, cause, action, owner, result, nature, status, close_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);

	const customers = ["华为", "中兴", "比亚迪", "大疆", "格力", "小米"];
	const products = ["PCB-4L", "PCB-6L", "PCB-HDI", "PCB-FPC"];
	const regions = ["华南", "华东", "华北", "西南", "海外"];
	const lines = ["L1", "L2", "L3", "L4"];
	const items = ["开路", "短路", "阻抗", "外观", "尺寸"];
	const inspectors = ["张三", "李四", "王五", "赵六"];

	for (let i = 0; i < 60; i++) {
		const month = 6 + (i % 4);
		const day = (i % 28) + 1;
		const customer = customers[i % customers.length];
		const product = products[i % products.length];
		const region = regions[i % regions.length];
		const quantity = 500 + ((i * 137) % 5000);
		const amount = quantity * (18 + (i % 40));
		insertOrder.run(customer, product, quantity, amount, region, `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
	}

	for (let i = 0; i < 40; i++) {
		const month = 6 + (i % 4);
		const day = (i % 27) + 1;
		const product = products[i % products.length];
		const batchNo = `B2026${String(month).padStart(2, "0")}${String(i + 1).padStart(3, "0")}`;
		const output = 2000 + ((i * 311) % 8000);
		const defectCount = Math.floor(output * (0.01 + (i % 5) * 0.008));
		insertProd.run(product, batchNo, output, defectCount, lines[i % lines.length], `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
	}

	for (let i = 0; i < 60; i++) {
		const month = 6 + (i % 4);
		const day = (i % 26) + 1;
		const batchNo = `B2026${String(month).padStart(2, "0")}${String((i % 40) + 1).padStart(3, "0")}`;
		const item = items[i % items.length];
		const total = 1000 + ((i * 97) % 5000);
		const failed = Math.floor(total * (0.005 + (i % 6) * 0.006));
		insertQuality.run(batchNo, item, total, failed, inspectors[i % inspectors.length], `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
	}

	const complaints = [
		["I20260823001", "成型", "工艺", "C829LL0263605A0", "涨缩不合格", "光学点到光学点不合格,要求1.19±0.075mm,实测1.277-1.3mm,大12-30um", "120PNL", "成型720SET", "返工过IR炉", "蚀刻时光学点走上限做的首件,再经过阻焊磨板,板子尺寸有拉伸,导致光学点偏大", "蚀刻首件走中值,对于光学点补偿有异常的找工艺优化", "陈付轩", "过IR炉1次后涨缩尺寸合格", "工艺参数", "是", "2026-08-24"],
		["I20260825001", "线路", "工艺", "C818WW0660497B3", "混批次", "卡槽不对,有手动修改", "线路120PNL/AOI 120PNL", "", "厂内特采留档/防焊曝光批次", "汽车板原来员工卡D2槽没有执行到位,D2槽有混,合批有手动修改", "交接班宣导进料严格卡D2槽,D2槽不对位的退回前站改善", "赵伟", "防焊曝光批次028/029,客户未反馈有异常", "违规操作", "是", "2026-08-26"],
		["I20260910001", "电镀", "工艺", "C772EE0460957B0", "面铜NG", "面铜不合格,面铜要求35.1um,实测29.63um,超下限5.47um", "电镀120PNL", "", "返工补镀", "从CMI工程分析,偏薄位置为夹头位置,铜球液位不足", "铜球不足及时补加,工艺给出电镀铜球理论耗用给物控", "谭龙飞", "返工补镀后铜厚合格", "工艺参数", "是", "2026-09-10"],
	];
	for (const c of complaints) {
		insertComplaint.run(...c);
	}
}

function insertSampleKnowledge(db) {
	const insert = db.prepare(
		`INSERT INTO knowledge
			(title, category, tags, summary, content, source, created_at,
			 version, valid_from, valid_to, scope, permission, status, standard_ref, author, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const now = new Date().toISOString();
	const rows = [
		{
			title: "IPC-6012 刚性印制板鉴定与性能规范",
			category: "标准规范",
			tags: "IPC,标准,品质,验收",
			summary: "刚性印制板鉴定与性能要求的国际通用标准,覆盖外观、尺寸、电气与可靠性验收。",
			content:
				"IPC-6012 是刚性印制板鉴定与性能的核心标准。\n\n【适用范围】全厂所有刚性 PCB 产品的来料检验、过程判定与出货验收。\n\n【关键要求】\n1. 外观验收依据 IPC-A-600,缺陷按轻微/重大/致命分级。\n2. 镀铜厚度(面铜)按客户图纸执行,常规要求不低于 35um,孔铜不低于 20um。\n3. 尺寸与公差:成型尺寸、光学点位置、孔位精度需满足客户图纸与测量系统要求。\n4. 可靠性:热应力、阻抗、耐电压等项目按产品等级执行。\n\n【版本说明】当前有效版本 v3.2,替代 v3.0/v3.1。",
			source: "标准采购/体系导入",
			created_at: now,
			version: "3.2",
			valid_from: "2024-01-01",
			valid_to: "2027-12-31",
			scope: "全厂",
			permission: "all",
			status: "approved",
			standard_ref: "IPC-6012",
			author: "体系文控",
			updated_at: now,
		},
		{
			title: "电镀面铜厚度控制标准",
			category: "工艺知识",
			tags: "电镀,面铜,厚度,工艺参数",
			summary: "电镀工序面铜厚度控制范围、测量方法与超差处置要求。",
			content:
				"电镀面铜厚度是线路品质的关键控制点。\n\n【控制范围】面铜要求按客户图纸,常规产品不低于 35um,超差按不合格品处理。\n\n【测量方法】采用 CMI 铜厚仪测量,重点关注夹头位置与板边位置,这两个区域最易偏薄。\n\n【超差处置】\n1. 偏薄:确认铜球液位与阳极面积,及时补加铜球后返工补镀。\n2. 偏厚:核对电流密度与时间,必要时退镀返工。\n3. 首件需走中值,禁止走上限/下限,避免后续工序拉伸叠加导致超差。\n\n【预防】铜球液位每班点检,工艺给出铜球理论耗用并报物控补料。",
			source: "工艺文件",
			created_at: now,
			version: "2.1",
			valid_from: "2025-03-01",
			valid_to: "2027-03-01",
			scope: "电镀工序",
			permission: "engineering,quality",
			status: "approved",
			standard_ref: "IPC-6012 §3.6.2",
			author: "工艺部",
			updated_at: now,
		},
		{
			title: "成型涨缩不合格(光学点偏大)处置案例",
			category: "品质案例",
			tags: "成型,涨缩,光学点,案例",
			summary: "光学点到光学点距离超上差 12-30um,根因为蚀刻首件走上限叠加阻焊磨板拉伸。",
			content:
				"【背景】客诉 CAR I20260823001:成型发现光学点到光学点不合格,要求 1.19±0.075mm,实测 1.277-1.3mm,偏大 12-30um,涉及 120PNL。\n\n【现象】涨缩不合格,光学点距离整体偏大。\n\n【根因】蚀刻首件时光学点按上限制作,再经过阻焊磨板,板子尺寸被拉伸,导致光学点偏大。\n\n【处置】返工过 IR 炉 1 次后,涨缩尺寸恢复合格。\n\n【预防】蚀刻首件走中值;对光学点补偿异常的板,工艺需专项优化。\n\n【验证结果】返工后涨缩尺寸合格,客户未再反馈异常。",
			source: "客诉 I20260823001",
			created_at: now,
			version: "1.0",
			valid_from: "2026-08-24",
			valid_to: "2028-08-24",
			scope: "成型/蚀刻",
			permission: "quality,engineering",
			status: "approved",
			standard_ref: "客户图纸(光学点 1.19±0.075mm)",
			author: "陈付轩",
			updated_at: now,
		},
		{
			title: "防焊曝光混批次(D2 槽卡槽)处置案例",
			category: "工程案例",
			tags: "混批次,防焊,D2槽,卡槽,案例",
			summary: "汽车板 D2 槽未严格执行导致混批次,通过进料严格卡槽与交接班宣导整改。",
			content:
				"【背景】客诉 CAR I20260825001:线路发现混批次,卡槽不对且有手动修改,涉及线路/AOI 各 120PNL。\n\n【根因】汽车板原员工卡 D2 槽未执行到位,D2 槽有混、合批有手动修改。\n\n【处置】厂内特采留档;防焊按曝光批次 028/029 分开处理。\n\n【预防】交接班宣导进料严格卡 D2 槽,槽位不对立即退回前站改善。\n\n【验证结果】客户未反馈有异常。",
			source: "客诉 I20260825001",
			created_at: now,
			version: "1.0",
			valid_from: "2026-08-26",
			valid_to: "2028-08-26",
			scope: "线路/防焊",
			permission: "engineering,quality",
			status: "approved",
			standard_ref: "D2 槽作业规范",
			author: "赵伟",
			updated_at: now,
		},
		{
			title: "电镀线铜球液位日常点检与补充规范",
			category: "设备维护",
			tags: "电镀,铜球,液位,点检,设备",
			summary: "电镀线铜球液位每班点检、异常补加与耗用上报的设备维护要求。",
			content:
				"【目的】防止铜球液位不足导致面铜偏薄。\n\n【点检要求】\n1. 每班开线前点检铜球液位与阳极溶解情况。\n2. 液位低于安全线立即补加,并记录补加量与时间。\n3. 发现铜球异常消耗,及时上报工艺与设备。\n\n【耗用管理】工艺给出电镀铜球理论耗用,物控据此备料,设备按点检表执行。\n\n【关联案例】面铜偏薄问题多由夹头位置铜球液位不足引起(见客诉 I20260910001)。",
			source: "设备点检表",
			created_at: now,
			version: "1.1",
			valid_from: "2025-06-01",
			valid_to: "2027-06-01",
			scope: "电镀线",
			permission: "equipment,engineering",
			status: "approved",
			standard_ref: "设备点检表",
			author: "设备部",
			updated_at: now,
		},
		{
			title: "铜球液位不足导致面铜偏薄案例",
			category: "设备案例",
			tags: "铜球,液位,面铜,电镀,案例",
			summary: "面铜实测 29.63um 低于 35.1um 要求,根因是夹头位置铜球液位不足。",
			content:
				"【背景】客诉 CAR I20260910001:电镀面铜不合格,要求 35.1um,实测 29.63um,超下限 5.47um,涉及 120PNL。\n\n【根因】CMI 工程分析显示偏薄位置为夹头位置,该处铜球液位不足。\n\n【处置】返工补镀,补镀后铜厚合格。\n\n【预防】铜球不足及时补加;工艺给出电镀铜球理论耗用给物控,设备每班点检液位。\n\n【验证结果】返工补镀后铜厚合格,结案。",
			source: "客诉 I20260910001",
			created_at: now,
			version: "1.0",
			valid_from: "2026-09-10",
			valid_to: "2028-09-10",
			scope: "电镀线",
			permission: "equipment,quality",
			status: "approved",
			standard_ref: "面铜 ≥35.1um(客户图纸)",
			author: "谭龙飞",
			updated_at: now,
		},
		{
			title: "PCB 常见缺陷与对策速查表",
			category: "知识库",
			tags: "缺陷,对策,速查,品质",
			summary: "开路、短路、阻抗、外观、尺寸等常见缺陷的现象与对策速查。",
			content:
				"【开路】常见于蚀刻过度、干膜破损,对策:检查蚀刻参数与干膜贴合。\n\n【短路】常见于显影不净、异物残留,对策:清洁显影段并复检 AOI。\n\n【阻抗】超差多与线宽、介质厚度有关,对策:按阻抗条测试并追溯压合参数。\n\n【外观】划伤、氧化、污染,对策:规范周转与存储,避免裸手接触板面。\n\n【尺寸】涨缩、孔位偏移,对策:控制首件中值,关注温湿度与拉伸工序。",
			source: "品质部整理",
			created_at: now,
			version: "1.3",
			valid_from: "2025-01-01",
			valid_to: "2027-01-01",
			scope: "全厂",
			permission: "all",
			status: "approved",
			standard_ref: "IPC-A-600",
			author: "品质部",
			updated_at: now,
		},
		{
			title: "IPC-A-600 印制板可接受性规范",
			category: "标准规范",
			tags: "IPC,外观,验收,标准",
			summary: "印制板外观可接受性判定依据,是 IPC-6012 外观验收的配套标准。",
			content:
				"IPC-A-600 用于印制板外观可接受性判定。\n\n【缺陷分级】轻微、重大、致命三级,分别对应让步接收、返工/拒收、报废。\n\n【典型判定】\n1. 开路/短路为致命缺陷。\n2. 露铜、划伤视深度与位置分级。\n3. 阻焊、字符缺陷按覆盖率与可读性判定。\n\n【使用方式】与客户图纸冲突时以客户图纸为准;版本更新以最新有效版本为准。",
			source: "标准采购/体系导入",
			created_at: now,
			version: "2024.0",
			valid_from: "2024-01-01",
			valid_to: "2027-12-31",
			scope: "全厂",
			permission: "all",
			status: "approved",
			standard_ref: "IPC-A-600",
			author: "体系文控",
			updated_at: now,
		},
	];
	for (const r of rows) {
		insert.run(
			r.title, r.category, r.tags, r.summary, r.content, r.source, r.created_at,
			r.version, r.valid_from, r.valid_to, r.scope, r.permission, r.status, r.standard_ref, r.author, r.updated_at,
		);
	}
}
