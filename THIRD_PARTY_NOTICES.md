# Third-Party Notices & Trademarks

## 1. Project Affiliation Statement

dsh-plugin-cli-hub is a **community open-source project**, maintained by volunteers. This project:

- Is **NOT affiliated with** DeepSeek AI officially (Beijing DeepSeek AI Technology Co., Ltd.)
- Is **NOT affiliated with** Anthropic, OpenAI, Google, xAI, Moonshot AI, ByteDance, GitHub (Microsoft), Zhipu AI, MiniMax, Baidu, Alibaba Tongyi, Volcano Engine, or any other company
- Relationship with DeepSeek Harness: it runs on the DeepSeek Harness framework as a "plugin / bundle", following the Cordis plugin architecture conventions — nothing more
- Relationship with the various AI CLI products: this plugin only **invokes CLI executables that the user has installed and holds a legitimate subscription license for**, on **the user's local machine**. The plugin itself:
  - Does not store or upload any of the user's API keys / session tokens / cookies
  - Does not reverse-proxy or store any traffic to vendors' cloud services
  - Does not include any vendor's closed-source components or SDKs

## 2. Trademark & Brand Disclaimer

The following names (and related logos) are registered or unregistered trademarks of their respective owners. This project's use of these names is limited to reasonably describing the invoked command-line tools by their function; it does not constitute trademark use, licensing, endorsement, or dilution:

- Claude Code®, Claude CLI, Anthropic — **Anthropic, Inc.**
- ChatGPT Code Interpreter / ChatGPT CLI, OpenAI o1 / GPT-4o — **OpenAI, Inc.**
- GitHub Copilot, Copilot Workspace, VS Code — **GitHub, Inc. (Microsoft Corporation)**
- Gemini CLI / Project IDX / Google AI Studio — **Google LLC**
- Codex (Claude for code companion) — **Trae / ByteDance** (attribution to be corrected per actual ownership)
- DeepSeek, DeepSeek Harness, DSH — **Beijing DeepSeek AI Technology Co., Ltd.**
- Kimi, Moonshot — **Moonshot AI (Shanghai Aisimofan Information Technology Co., Ltd.)**
- xAI Grok — **xAI Corp.**
- Snow, Mistral Large, Mistral CLI — **Mistral AI, SAS**
- Ollama, llama.cpp, LLaMA — **Ollama, Inc. / Meta Platforms, Inc.**
- Alibaba Tongyi / Alibaba Cloud DashScope — **Alibaba Group**
- Baidu Qianfan / ERNIE Bot — **Baidu, Inc.**
- ByteDance Volcano Engine (Doubao) — **ByteDance Inc.**
- Zhipu GLM — **Zhipu AI (Beijing Zhipu Huazhang Technology Co., Ltd.)**
- MiniMax abab — **MiniMax (Shanghai Aibi Technology Co., Ltd.)**
- Codeium / Windsurf — **Codeium, Inc.**
- Sourcery / CodeRabbit / Pieces for Developers / Aider / Continue.dev / OpenHands (formerly OpenDevin) / Paperclip — their respective original authors or copyright-holding companies
- Snowflake Cortex / Snowflake Arctic — **Snowflake Inc.**

**If any attribution above needs correcting, or your company would rather not have its trademark mentioned by this project**, please open an Issue on GitHub and we will handle it within 72 hours.

## 3. Runtime third-party npm dependencies

| Package | SPDX License | Purpose |
|---|---|---|
| `cordis` ^4.0.0-rc.8 | MIT | Plugin framework ("everything is a plugin" architecture core) |
| `cosmokit` ^1.8.1 | MIT | General utility library (schema / object utilities) |
| `json-schema-to-ts` ^3.1.1 | MIT | JSON Schema -> TS type inference |
| `minimatch` ^10.0.1 | ISC | Wildcard matching (adapter fingerprint scanning) |

## 4. Development-time third-party npm dependencies (dev only; not shipped)

| Package | SPDX License | Purpose |
|---|---|---|
| `@types/node` ^20.14.0 | MIT | Node.js type declarations |
| `@vitest/coverage-v8` ^2.1.9 | MIT | Vitest coverage reporting (v8 engine) |
| `esbuild` ^0.28.2 | MIT | CJS/ESM bundling |
| `oxlint` ^0.9.0 | MIT | Linting (Rust-based, fast) |
| `tsdown` ^0.4.0 | MIT | Build wrapper |
| `typescript` ^5.5.0 | Apache-2.0 | TS compiler |
| `vitest` ^2.0.0 | MIT | Test runner |

## 5. Included example commands & third-party documentation copyright

The command-line argument descriptions for the various AI CLIs appearing in this project's README / code (e.g. `claude code --model`, `kimi chat --file`) are all taken from the respective vendors' publicly released documentation or `--help` output, quoted under the principle of fair use; if any vendor believes this exceeds fair use, please contact the maintainer to have the corresponding descriptions removed.
