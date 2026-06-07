<div align="center">

<img src="./.github/assets/devo-readme-logo.png" alt="Devo" width="220" />

</div>

<div align="center">

**一个轻量级、模型中立的编程代理，以单一二进制文件运行。快速、token 高效，并且高度可定制。**

[![Stars](https://img.shields.io/github/stars/7df-lab/devo?style=flat-square)](https://github.com/7df-lab/devo/stargazers)
[![Language](https://img.shields.io/badge/language-Rust-E57324?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/7df-lab/devo/pulls)
[![CI](https://img.shields.io/github/actions/workflow/status/7df-lab/devo/ci.yml?branch=main&style=flat-square)](https://github.com/7df-lab/devo/actions)
[![Release](https://img.shields.io/github/v/release/7df-lab/devo?style=flat-square)](https://github.com/7df-lab/devo/releases)

[English](./README.md) | [简体中文](./README.zh-Hans.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[功能](#功能) · [已测试模型](#已测试模型) · [已测试平台](#已测试平台) · [安装](#安装) · [快速开始](#快速开始) · [文档](#docs)

</div>

---

## 功能

- **内置语义代码搜索** - 运行本地 CPU 代码嵌入模型，并结合密集检索
  与 BM25 关键词匹配，相比仅使用 grep/find 的代理减少代码搜索上下文。
- **自带模型提供商** - 通过 provider/model 绑定接入 OpenAI 兼容、
  Anthropic 兼容、DeepSeek、Qwen、Kimi、GLM、MiniMax、Xiaomi MiMo、
  OpenRouter 或本地端点。
- **MCP 支持** - 通过
  [Model Context Protocol](https://modelcontextprotocol.io/) 服务器连接外部工具和上下文。
- **Skill 支持** - 将可复用工作流、说明、脚本和参考资料打包成可复用的
  [Agent Skills](https://agentskills.io/)。
- **长任务支持** - 让 Devo 在多轮工作中自动管理上下文，避免任务变长后丢失上下文。
- **多代理支持** - 将工作拆分给专门代理，同时在会话中保持协调过程可见。
- **Plan Mode** - 在实现开始前，把较大的任务拆成清晰的多步骤计划。
- **并行工具调用** - 并行运行多个相互独立的工具，让模型少等待、多推进。
- **带权限的工具执行** - 在敏感工具调用触碰工作区前进行审查。
- **可审计会话** - 保留模型输出、工具调用、审批、token 用量和会话历史，
  方便检查和恢复。
- **成本和上下文可见性** - 在提供商支持时显示输入/输出 token、缓存 token
  和上下文窗口用量。
- **轻量级 Rust 运行时** - 使用 Rust 构建，内存开销低，本地运行时紧凑。

## 已测试模型

<p>
  <img alt="DeepSeek v4 Flash / Pro" src="https://img.shields.io/badge/DeepSeek-v4%20Flash%20%2F%20Pro-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" />
  <img alt="Qwen3 Coder Next" src="https://img.shields.io/badge/Qwen3-Coder%20Next-615CED?style=flat-square&logo=qwen&logoColor=white" />
  <img alt="Kimi K2.5" src="https://img.shields.io/badge/Kimi-K2.5-111111?style=flat-square&logo=moonshotai&logoColor=white" />
  <img alt="MiniMax M2.7" src="https://img.shields.io/badge/MiniMax-M2.7-0B5FFF?style=flat-square&logo=minimax&logoColor=white" />
  <img alt="GLM 5.1" src="https://img.shields.io/badge/GLM-5.1-7856FF?style=flat-square" />
</p>

Devo 的内置模型目录包含 Qwen、Kimi、MiniMax、GLM 和 DeepSeek 的已测试模型定义。
Provider 端点仍可通过 provider/model 绑定配置。

## 已测试平台

<p>
  <img alt="macOS 已测试" src="https://img.shields.io/badge/macOS-tested-000000?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Linux 已测试" src="https://img.shields.io/badge/Linux-tested-FCC624?style=flat-square&logo=linux&logoColor=000000" />
  <img alt="Windows 已测试" src="https://img.shields.io/badge/Windows-tested-0078D4?style=flat-square&logo=windows&logoColor=white" />
</p>

Devo 已在 macOS、Linux、Windows 和麒麟操作系统上测试。

### 面向中国企业用户

<p>
  <img alt="麒麟操作系统已测试" src="https://img.shields.io/badge/Kylin%20OS-tested-1E88E5?style=flat-square" />
  <img alt="HarmonyOS 支持已在路线图中" src="https://img.shields.io/badge/HarmonyOS-on%20the%20road-111111?style=flat-square&logo=harmonyos&logoColor=white" />
</p>

之所以单独标出麒麟操作系统覆盖，是因为在中国企业环境中，国产操作系统经常是实际部署要求的一部分。
HarmonyOS 支持已在路线图中；欢迎拥有 HarmonyOS 设备的贡献者为该平台构建、测试并发布版本。

## 截图

<p align="center">
  <img width="100%" alt="Devo 在终端中运行" src="./.github/assets/devo-readme-screenshot.png" />
</p>

## 安装

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/7df-lab/devo/main/install.sh | sh
```

### Windows

```powershell
irm 'https://raw.githubusercontent.com/7df-lab/devo/main/install.ps1' | iex
```

在线安装器会把 `devo` 放到 Devo home 目录下，安装用于快速仓库搜索的
`rg` sidecar，并可预安装 `code_search` 使用的本地 Hugging Face 模型。

预安装本地 `code_search` 模型：

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/7df-lab/devo/main/install.sh | sh -s -- --install-code-search-model
```

Windows:

```powershell
$env:DEVO_INSTALL_CODE_SEARCH_MODEL = "1"; irm 'https://raw.githubusercontent.com/7df-lab/devo/main/install.ps1' | iex
```

<details>
<summary>离线安装</summary>

许多企业和内网环境无法访问互联网。Devo 安装器支持离线模式，会从安装脚本所在目录读取所有必需资源，
并且不会访问网络。

在一台可以访问互联网的机器上：

1. 下载安装脚本：Linux/macOS 使用 `install.sh`，Windows 使用 `install.ps1`。
2. 下载目标 CPU 和操作系统对应的最新 Devo release asset，例如 `x86_64`
   与 `aarch64`/`arm64`。
3. 下载本地语义 `code_search` 使用的 Hugging Face `minishlab/potion-code-16M`
   模型文件：`config.json`、`model.safetensors` 和 `tokenizer.json`。
4. 下载目标 CPU 和操作系统对应的 `ripgrep` release asset。

把这些文件放在安装脚本旁边。模型文件可以直接放在安装脚本旁边，也可以放在
`minishlab--potion-code-16M/` 子目录下。

Linux / macOS:

```bash
sh ./install.sh --offline
```

Windows:

```powershell
.\install.ps1 -Offline
```

离线模式会把模型安装到
`<DEVO_HOME>/local-models/minishlab--potion-code-16M`，这是运行时
code-search provider 使用的目录。如果没有设置 `DEVO_HOME`，该路径为
`~/.devo/local-models/minishlab--potion-code-16M`。

</details>

## 快速开始

配置 provider，打开一个仓库，然后启动 TUI：

```bash
cd /path/to/your/repo
devo onboard
```

常用命令：

```bash
devo                         # 在当前仓库启动交互式 TUI
devo resume <session-id>
```

## 配置

`devo onboard` 是推荐的设置路径。如需手动配置，Devo 会按以下顺序合并设置：

1. 内置默认值
2. `DEVO_HOME/config.toml` - 用户级配置，默认在 macOS/Linux 上为
   `~/.devo/config.toml`，在 Windows 上为 `C:\Users\yourname\.devo\config.toml`
3. `<workspace>/.devo/config.toml` - 项目级配置
4. CLI flags

凭据单独保存在 `DEVO_HOME/auth.json`；`config.toml` 应引用 credential id，
而不是直接存储 API key。

最小结构：

```toml
[defaults]
model_binding = "deepseek-v4-flash-api-deepseek-com"

[providers."api.deepseek.com"]
enabled = true
name = "api.deepseek.com"
base_url = "https://api.deepseek.com"
credential = "api_deepseek_com_api_key"
wire_apis = ["openai_chat_completions"]

[model_bindings.deepseek-v4-flash-api-deepseek-com]
enabled = true
model_slug = "deepseek-v4-flash"
provider = "api.deepseek.com"
model_name = "deepseek-v4-flash"
display_name = "DeepSeek V4 Flash"
invocation_method = "openai_chat_completions"
default_reasoning_effort = "high"
```

关键区分如下：

- `model_slug` 从 `models.json` 中选择 Devo 的本地模型元数据。
- `provider` 选择已配置的连接记录。
- `model_name` 是发送到 provider 的特定模型字符串。
- `invocation_method` 选择 provider 协议，例如
  [`openai_chat_completions`](https://developers.openai.com/api/reference/chat-completions/overview)、
  [`openai_responses`](https://developers.openai.com/api/reference/responses/overview)，
  或 [`anthropic_messages`](https://platform.claude.com/docs/en/api/messages)。

### 自定义模型

如果想使用的模型不在内置列表中，请将它添加到 `models.json`，然后通过
`config.toml` 绑定。

用户级模型目录：

- macOS/Linux: `~/.devo/models.json`
- Windows: `C:\Users\yourname\.devo\models.json`

项目级覆盖也可以放在 `<workspace>/.devo/models.json`。
在 `models.json` 中，`provider` 是该模型的默认 wire API 元数据；实际端点仍由
`config.toml` 中的 `provider` 字段选择。

示例 `models.json` 条目：

```json
[
  {
    "slug": "my-coding-model",
    "display_name": "My Coding Model",
    "channel": "Custom",
    "provider": "openai_chat_completions",
    "description": "Custom OpenAI-compatible coding model.",
    "thinking_capability": "unsupported",
    "context_window": 200000,
    "effective_context_window_percent": 95,
    "max_tokens": 4096,
    "input_modalities": ["text"],
    "base_instructions": "You are Devo, a coding agent. Help the user edit and understand code."
  }
]
```

然后从 model binding 中引用该 `slug`：

```toml
[model_bindings.my-coding-model-example]
enabled = true
model_slug = "my-coding-model"
provider = "my.provider"
model_name = "provider-specific-model-name"
display_name = "My Coding Model"
invocation_method = "openai_chat_completions"
```

## 常见问题

### 项目状态如何？

Devo 仍处于 1.0 之前并在积极开发中。它已经适合本地评估、实验和贡献者使用；
公共 API 和配置仍可能变化。

### 支持哪些模型？

内置模型元数据目前覆盖 Qwen、Kimi、MiniMax、GLM 和 DeepSeek 系列。
任何支持 OpenAI 兼容 Chat Completions、OpenAI 兼容 Responses 或
Anthropic Messages API 的模型端点，都可以通过 provider/model 绑定接入。

## 参与贡献

项目仍处于早期阶段，欢迎贡献：

- 关于 client/server runtime、provider layer、safety model 和 TUI 的架构反馈。
- 文档和翻译。
- Provider、model 和 wire API 覆盖。
- 带验证命令和回归测试的聚焦修复。

请打开 issue 或 pull request 讨论变更。

## Star 历史

<a href="https://www.star-history.com/?repos=7df-lab%2Fdevo&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=7df-lab/devo&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=7df-lab/devo&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=7df-lab/devo&type=date&legend=top-left" />
 </picture>
</a>

## 许可证

本项目采用 [MIT License](./LICENSE) 授权。

---

**如果你觉得 Devo 有用，请考虑给它一个 star。**
