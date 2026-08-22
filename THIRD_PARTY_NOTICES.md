# Third-Party Notices & Trademarks (第三方声明与商标免责)

## 1. 项目归属声明

dsh-plugin-cli-hub 是**社区开源项目**，由志愿者维护。本项目：

- ❌ **不隶属于** DeepSeek AI 官方（北京深度求索科技有限公司）
- ❌ **不隶属于** Anthropic、OpenAI、Google、xAI、Moonshot AI（月之暗面）、ByteDance（字节跳动）、GitHub（Microsoft）、智谱 AI（Zhipu AI）、MiniMax、百度、阿里通义、火山引擎等公司
- ✅ 与 DeepSeek Harness 的关系：作为一个"插件（plugin / bundle）"运行在 DeepSeek Harness 框架上，遵循 Cordis 插件架构约定，仅此而已
- ✅ 与各 AI CLI 产品的关系：本插件仅在**用户的本地计算机**上**调用用户已安装、且用户自己持有合法订阅授权**的 CLI 可执行文件。插件本身：
  - 不保存、不上传用户任何 API Key / Session Token / Cookie
  - 不反向代理或存储任何厂商云服务的调用流量
  - 不包含任何厂商的闭源组件或 SDK

## 2. 商标与品牌免责

以下名称（及相关 Logo）是其各自版权方的注册商标或未注册商标。本项目对这些名称的使用仅限于"根据其功能合理地描述被调用的命令行工具名称"，不构成对商标的使用、授权、背书或淡化：

- Claude Code®, Claude CLI, Anthropic — **Anthropic, Inc.**
- ChatGPT Code Interpreter / ChatGPT CLI, OpenAI o1 / GPT-4o — **OpenAI, Inc.**
- GitHub Copilot, Copilot Workspace, VS Code — **GitHub, Inc. (Microsoft Corporation)**
- Gemini CLI / Project IDX / Google AI Studio — **Google LLC**
- Codex (Claude for code companion) — **Trae / ByteDance**（按实际归属更正）
- DeepSeek, DeepSeek Harness, DSH — **Beijing DeepSeek AI Technology Co., Ltd.**
- Kimi, Moonshot — **Moonshot AI (Shanghai Aisimofan Information Technology Co., Ltd.)**
- xAI Grok — **xAI Corp.**
- Snow, Mistral Large, Mistral CLI — **Mistral AI, SAS**
- Ollama, llama.cpp, LLaMA — **Ollama, Inc. / Meta Platforms, Inc.**
- Alibaba Tongyi (通义) / Alibaba Cloud DashScope — **Alibaba Group**
- Baidu Qianfan / ERNIE Bot — **Baidu, Inc.**
- ByteDance Volcano Engine (豆包) — **ByteDance Inc.**
- Zhipu GLM — **Zhipu AI (Beijing Zhipu Huazhang Technology Co., Ltd.)**
- MiniMax abab — **MiniMax (Shanghai Aibi Technology Co., Ltd.)**
- Codeium / Windsurf — **Codeium, Inc.**
- Sourcery / CodeRabbit / Pieces for Developers / Aider / Continue.dev / OpenHands (原 OpenDevin) / Paperclip — 各自的原作者或版权持有公司
- Snowflake Cortex / Snowflake Arctic — **Snowflake Inc.**

**如果上述列表中存在需要纠正的归属，或贵公司不希望本项目提及您的商标名**，请在 GitHub 上开 Issue，我们将在 72 小时内处理。

## 3. 运行时第三方 npm 依赖（Runtime）

| 包 | SPDX License | 用途 |
|---|---|---|
| `cordis` ^4.0.0-rc.8 | MIT | 插件框架（"万物皆插件"架构核心）|
| `cosmokit` ^1.8.1 | MIT | 通用工具库（Schema / Object 操作）|
| `json-schema-to-ts` ^3.1.1 | MIT | JSON Schema → TS 类型推导 |
| `minimatch` ^10.0.1 | ISC | 通配符匹配（adapter fingerprint 扫描）|

## 4. 开发期第三方 npm 依赖（Dev only，不随发布打包）

| 包 | SPDX License | 用途 |
|---|---|---|
| `@types/node` ^20.14.0 | MIT | Node.js 类型声明 |
| `@vitest/coverage-v8` ^2.1.9 | MIT | Vitest 覆盖率报告（v8 引擎）|
| `esbuild` ^0.28.2 | MIT | CJS/ESM 构建 |
| `oxlint` ^0.9.0 | MIT | Lint（Rust 实现，速度快）|
| `tsdown` ^0.4.0 | MIT | 构建封装 |
| `typescript` ^5.5.0 | Apache-2.0 | TS 编译 |
| `vitest` ^2.0.0 | MIT | 测试运行器 |

## 5. 附带的示例命令与第三方文档版权

本项目 README / 代码中出现的对各 AI CLI 的命令行参数说明（例如 `claude code --model`、`kimi chat --file` 等），均来自各自厂商**公开发布的文档或 `--help` 输出**，按照 "合理使用"（fair use）原则引用；如果某厂商认为超出了合理使用范围，请联系 maintainer 移除相应说明。
