// 数据库层:持久化 SQLite,首次启动预置 PCB 示例数据
// 后期对接企业真实数据时,只需替换这里的初始化逻辑
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../data/data.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

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
	`);

	// 示例数据只在首次初始化时插入
	const existing = db.prepare("SELECT COUNT(*) AS c FROM orders").get();
	if (existing.c === 0) {
		insertSampleData(db);
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
