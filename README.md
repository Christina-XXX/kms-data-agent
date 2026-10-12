# 满坤 KMS 知识管理平台

面向 PCB 企业的知识管理系统(KMS),基于开源 [Pi Agent](https://github.com/earendil-works/pi) 框架二次开发。

以数据智能助手「小芯」为核心,覆盖 **知识录入 → 知识查询 → 知识治理 → 经验沉淀 → 客诉管理** 五大业务闭环。

## ✨ 核心功能

| 模块 | 说明 | 状态 |
|---|---|---|
| 🔍 知识查询 | 自然语言 → SQL → 图表 → 分析结论 | ✅ 已实现 |
| 📥 知识录入 | 上传 Excel/CSV → Agent 解析/抽取/分类 → 生成草稿 → 确认入库 | ✅ 已实现 |
| 📋 客诉管理 | 客诉列表 + 详情 + 一键生成 8D 报告 / FA 失效分析 | ✅ 已实现 |
| 💡 经验沉淀 | 描述问题 → Agent 整理 → 人工审核 → 存回知识库 | ✅ 已实现 |
| 🧰 工作台 | 清单生成 / 文件比较 / 报告生成,产出可下载交付物 | ✅ 已实现 |
| 🛡 知识治理 | 过期 / 即将过期 / 重复 / 无版本 / 冲突检测 | ✅ 已实现 |

## 🎨 界面特色

- 粉色治愈系 UI,可爱的数据助手「小芯」(日系平涂头像)
- 流式对话 + Markdown 渲染 + ECharts 图表
- 历史对话管理(查看 / 删除单条 / 清空全部)
- 用户登录(手机号 + 密码,部门自行填写)
- 左右侧栏可收起、可拖拽调整宽度

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML / CSS / JS + ECharts + marked |
| 后端 | Node.js + ws |
| Agent 引擎 | `@earendil-works/pi-coding-agent`(Pi SDK) |
| 大模型 | DeepSeek(OpenAI 兼容) |
| 数据库 | SQLite(Node 内置 `node:sqlite`) |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 22.19

### 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 配置 DeepSeek Key
#    复制 .env.example 为 .env,填入你的 key
#    Windows 用户也可直接编辑 .env

# 3. 启动
npm start
# 或 Windows 双击 start.bat

# 4. 浏览器打开
#    http://localhost:3000
```

首次启动会自动创建 SQLite 数据库并预置 PCB 示例数据(订单 / 生产 / 质检 / 客诉)。

## 📦 服务器部署

见仓库外的 `deploy.sh`(或按以下步骤):

```bash
# 1. 安装 Node.js ≥ 22
# 2. 上传项目到服务器
# 3. 安装依赖
npm install --registry=https://registry.npmmirror.com
# 4. 配置 .env(DEEPSEEK_API_KEY)
# 5. 后台启动
nohup node server/index.js > server.log 2>&1 &
```

启动后内网访问 `http://<服务器IP>:3000`。

## 📁 目录结构

```
kms-data-agent/
├── server/
│   ├── index.js    # HTTP + WebSocket 服务、历史/客诉/知识/经验/认证 API
│   ├── agent.js    # Harness:Pi Agent 会话封装(DeepSeek + 系统提示 + 专家模式)
│   ├── skills.js   # Skills:定义"怎么做"(专家问答/经验整理/清单/8D/FA/比较/知识整理)
│   ├── tools.js    # Tools:实际操作(query_database / search_knowledge / load_skill / save_artifact)
│   ├── rag.js      # 检索层:BM25 + bigram 召回 + 版本/时效/范围/权限过滤 + 治理分析
│   └── db.js       # SQLite 持久化 + PCB 示例数据(含治理字段迁移)
├── public/
│   └── index.html  # 前端(六模块单页应用)
├── .env.example    # 配置模板(真实 .env 不入库)
├── start.bat       # Windows 一键启动
└── package.json
```

## 🔄 一次问答的数据流

```
用户提问 → Pi Agent 生成 SQL → query_database 执行
        → 结果回传 Agent → Agent 输出分析结论
        → 同时结果(表格 + 图表)实时推送到前端
```

## 🧭 需求 ↔ 架构映射

| 需求 | 架构对应 |
|---|---|
| 快速找到资料(RAG) | `db.js` 存管知识 + `rag.js` 检索(BM25 + bigram)+ `search_knowledge` 工具 |
| 时效与正确版本 | `knowledge` 表 `version / valid_from / valid_to / scope / permission`,检索时过滤+同标题取最高版本 |
| 问解决办法(AI 问答) | `expert-answer` Skill:有效标准 + 历史案例,标注依据与 [编号] 引用 |
| 完成具体工作 | Harness(`agent.js`)承载执行 + Skills(`skills.js`)定义做法 + Tools(`tools.js`)实际操作 |
| 沉淀成功经验 | `experience-consolidation` Skill 整理 + `/api/experience/review` 人确认审核后存回知识库 |
| 专家模式 | `EXPERT_ROLES` 专业角色 + 对应 Skills/知识权限(`rolePermissions`)/工具 |

## 🗺 路线图

- [x] 平台骨架 + 对话式数据查询
- [x] 客诉管理(8D / FA)
- [x] 知识录入(Excel/CSV → Agent 草稿 → 入库)
- [x] 知识检索(知识库可被查询)
- [x] 经验沉淀(引导式总结)
- [x] 用户登录、历史管理
- [x] 知识治理(过期 / 即将过期 / 重复 / 无版本 / 冲突检测)
- [x] 专家模式(品质 / 工程 / 设备 / 通用)
- [x] 工作台(清单 / 文件比较 / 报告交付物)
- [ ] 更多文档格式(Word / PDF)解析

## 🔒 安全说明

- `.env`、`data/`、`history/` 已加入 `.gitignore`,不会提交到仓库
- 用户密码使用 SHA-256 加盐哈希存储,不明文保存
- 请勿在代码中硬编码 API Key
