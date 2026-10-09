# PCB 数据智能助手(KMS Data Agent)

面向 PCB 企业的知识库/数据智能问答平台,**基于开源 Pi Agent 框架二次开发**。
前期目标:搭通「自然语言 → SQL → 图表 → 分析结论」的最小平台骨架。

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | 原生 HTML/CSS/JS + ECharts | 聊天界面 + 图表,零构建 |
| 后端 | Node.js + ws | HTTP 静态服务 + WebSocket 对话通道 |
| Agent 引擎 | `@earendil-works/pi-coding-agent`(Pi SDK) | 二次开发核心 |
| 大模型 | DeepSeek(OpenAI 兼容) | 通过 `DEEPSEEK_API_KEY` 认证 |
| 数据库 | SQLite(Node 内置 `node:sqlite`) | 前期示例数据,后期对接企业真实库 |

## 架构与数据流

```
浏览器(聊天 + 图表)
   ↓ WebSocket
Node.js 服务
   ├─ Pi Agent(DeepSeek)——理解自然语言、决定查询、生成分析结论
   ├─ 自定义工具 query_database ——执行 SQL(只读)
   └─ SQLite 数据库
```

一次问答的完整链路:
`用户提问 → Pi Agent 生成 SQL → query_database 执行 → 结果回传 Agent → Agent 输出分析结论`,同时查询结果(表格 + 图表)实时推送到前端。

## 运行

环境要求:Node.js ≥ 22.19(本机已装 v24)。

```bash
# 1. 安装依赖
npm install

# 2. 配置 DeepSeek Key(参考 .env.example 创建 .env)
#    .env 已配置,注意不要提交到 git

# 3. 启动
npm start

# 4. 浏览器打开
http://localhost:3000
```

## 目录结构

```
kms-data-agent/
├── server/
│   ├── index.js    # 服务入口(HTTP + WebSocket)
│   ├── agent.js    # Pi Agent 封装(DeepSeek + 系统提示)
│   ├── tools.js    # 自定义工具:query_database
│   └── db.js       # SQLite + PCB 示例数据
├── public/
│   └── index.html  # 前端页面
├── .env            # DeepSeek Key(不提交)
└── package.json
```

## 后续规划

1. ✅ 阶段一:平台骨架 + 对话跑通(当前)
2. 阶段二:对接企业真实数据源(替换 `db.js` 或接入企业接口)
3. 阶段三:知识库检索(RAG),从结构化 SQL 扩展到非结构化知识
4. 阶段四:多会话、用户权限、审计日志等平台化能力
