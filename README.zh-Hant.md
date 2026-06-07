<div align="center">

<img src="./.github/assets/devo-readme-logo.png" alt="Devo" width="220" />

</div>

<div align="center">

**一個輕量級、模型中立的程式碼代理，以單一二進位檔執行。快速、token 高效，並且高度可自訂。**

[![Stars](https://img.shields.io/github/stars/7df-lab/devo?style=flat-square)](https://github.com/7df-lab/devo/stargazers)
[![Language](https://img.shields.io/badge/language-Rust-E57324?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/7df-lab/devo/pulls)
[![CI](https://img.shields.io/github/actions/workflow/status/7df-lab/devo/ci.yml?branch=main&style=flat-square)](https://github.com/7df-lab/devo/actions)
[![Release](https://img.shields.io/github/v/release/7df-lab/devo?style=flat-square)](https://github.com/7df-lab/devo/releases)

[English](./README.md) | [简体中文](./README.zh-Hans.md) | [繁體中文](./README.zh-Hant.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

[功能](#功能) · [已測試模型](#已測試模型) · [已測試平台](#已測試平台) · [安裝](#安裝) · [快速開始](#快速開始) · [文件](#docs)

</div>

---

## 功能

- **內建語義程式碼搜尋** - 執行本地 CPU 程式碼嵌入模型，並結合密集檢索
  與 BM25 關鍵字比對，相比僅使用 grep/find 的代理減少程式碼搜尋上下文。
- **自帶模型供應商** - 透過 provider/model 綁定接入 OpenAI 相容、
  Anthropic 相容、DeepSeek、Qwen、Kimi、GLM、MiniMax、Xiaomi MiMo、
  OpenRouter 或本地端點。
- **MCP 支援** - 透過
  [Model Context Protocol](https://modelcontextprotocol.io/) 伺服器連接外部工具和上下文。
- **Skill 支援** - 將可重複工作流程、說明、腳本和參考資料打包成可重用的
  [Agent Skills](https://agentskills.io/)。
- **長時間任務支援** - 讓 Devo 在多輪工作中自動管理上下文，避免任務變長後丟失脈絡。
- **多代理支援** - 將工作拆分給專門代理，同時在會話中保持協調過程可見。
- **Plan Mode** - 在實作開始前，把較大的任務拆成清晰的多步驟計畫。
- **平行工具呼叫** - 平行執行多個相互獨立的工具，讓模型少等待、多推進。
- **帶權限的工具執行** - 在敏感工具呼叫觸碰工作區前進行審查。
- **可稽核會話** - 保留模型輸出、工具呼叫、審批、token 用量和會話歷史，
  方便檢查和恢復。
- **成本和上下文可見性** - 在供應商支援時顯示輸入/輸出 token、快取 token
  和上下文視窗用量。
- **輕量級 Rust 執行階段** - 使用 Rust 建構，記憶體開銷低，本地執行階段緊湊。

## 已測試模型

<p>
  <img alt="DeepSeek v4 Flash / Pro" src="https://img.shields.io/badge/DeepSeek-v4%20Flash%20%2F%20Pro-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" />
  <img alt="Qwen3 Coder Next" src="https://img.shields.io/badge/Qwen3-Coder%20Next-615CED?style=flat-square&logo=qwen&logoColor=white" />
  <img alt="Kimi K2.5" src="https://img.shields.io/badge/Kimi-K2.5-111111?style=flat-square&logo=moonshotai&logoColor=white" />
  <img alt="MiniMax M2.7" src="https://img.shields.io/badge/MiniMax-M2.7-0B5FFF?style=flat-square&logo=minimax&logoColor=white" />
  <img alt="GLM 5.1" src="https://img.shields.io/badge/GLM-5.1-7856FF?style=flat-square" />
</p>

Devo 的內建模型目錄包含 Qwen、Kimi、MiniMax、GLM 和 DeepSeek 的已測試模型定義。
Provider 端點仍可透過 provider/model 綁定配置。

## 已測試平台

<p>
  <img alt="macOS 已測試" src="https://img.shields.io/badge/macOS-tested-000000?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Linux 已測試" src="https://img.shields.io/badge/Linux-tested-FCC624?style=flat-square&logo=linux&logoColor=000000" />
  <img alt="Windows 已測試" src="https://img.shields.io/badge/Windows-tested-0078D4?style=flat-square&logo=windows&logoColor=white" />
</p>

Devo 已在 macOS、Linux、Windows 和麒麟作業系統上測試。

### 面向中國企業使用者

<p>
  <img alt="麒麟作業系統已測試" src="https://img.shields.io/badge/Kylin%20OS-tested-1E88E5?style=flat-square" />
  <img alt="HarmonyOS 支援已在路線圖中" src="https://img.shields.io/badge/HarmonyOS-on%20the%20road-111111?style=flat-square&logo=harmonyos&logoColor=white" />
</p>

之所以單獨標出麒麟作業系統覆蓋，是因為在中國企業環境中，國產作業系統經常是實際部署要求的一部分。
HarmonyOS 支援已在路線圖中；歡迎擁有 HarmonyOS 裝置的貢獻者為該平台建構、測試並發布版本。

## 截圖

<p align="center">
  <img width="100%" alt="Devo 在終端機中執行" src="./.github/assets/devo-readme-screenshot.png" />
</p>

## 安裝

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/7df-lab/devo/main/install.sh | sh
```

### Windows

```powershell
irm 'https://raw.githubusercontent.com/7df-lab/devo/main/install.ps1' | iex
```

線上安裝器會把 `devo` 放到 Devo home 目錄下，安裝用於快速儲存庫搜尋的
`rg` sidecar，並可預安裝 `code_search` 使用的本地 Hugging Face 模型。

預安裝本地 `code_search` 模型：

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/7df-lab/devo/main/install.sh | sh -s -- --install-code-search-model
```

Windows:

```powershell
$env:DEVO_INSTALL_CODE_SEARCH_MODEL = "1"; irm 'https://raw.githubusercontent.com/7df-lab/devo/main/install.ps1' | iex
```

<details>
<summary>離線安裝</summary>

許多企業和內網環境無法存取網際網路。Devo 安裝器支援離線模式，會從安裝腳本所在目錄讀取所有必需資源，
並且不會存取網路。

在一台可以存取網際網路的機器上：

1. 下載安裝腳本：Linux/macOS 使用 `install.sh`，Windows 使用 `install.ps1`。
2. 下載目標 CPU 和作業系統對應的最新 Devo release asset，例如 `x86_64`
   與 `aarch64`/`arm64`。
3. 下載本地語義 `code_search` 使用的 Hugging Face `minishlab/potion-code-16M`
   模型檔案：`config.json`、`model.safetensors` 和 `tokenizer.json`。
4. 下載目標 CPU 和作業系統對應的 `ripgrep` release asset。

把這些檔案放在安裝腳本旁邊。模型檔案可以直接放在安裝腳本旁邊，也可以放在
`minishlab--potion-code-16M/` 子目錄下。

Linux / macOS:

```bash
sh ./install.sh --offline
```

Windows:

```powershell
.\install.ps1 -Offline
```

離線模式會把模型安裝到
`<DEVO_HOME>/local-models/minishlab--potion-code-16M`，這是執行階段
code-search provider 使用的目錄。如果沒有設定 `DEVO_HOME`，該路徑為
`~/.devo/local-models/minishlab--potion-code-16M`。

</details>

## 快速開始

配置 provider，開啟一個儲存庫，然後啟動 TUI：

```bash
cd /path/to/your/repo
devo onboard
```

常用命令：

```bash
devo                         # 在目前儲存庫啟動互動式 TUI
devo resume <session-id>
```

## 配置

`devo onboard` 是推薦的設定路徑。如需手動配置，Devo 會按以下順序合併設定：

1. 內建預設值
2. `DEVO_HOME/config.toml` - 使用者級配置，預設在 macOS/Linux 上為
   `~/.devo/config.toml`，在 Windows 上為 `C:\Users\yourname\.devo\config.toml`
3. `<workspace>/.devo/config.toml` - 專案級配置
4. CLI flags

憑據單獨保存在 `DEVO_HOME/auth.json`；`config.toml` 應引用 credential id，
而不是直接儲存 API key。

最小結構：

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

關鍵區分如下：

- `model_slug` 從 `models.json` 中選擇 Devo 的本地模型中繼資料。
- `provider` 選擇已配置的連線記錄。
- `model_name` 是傳送到 provider 的特定模型字串。
- `invocation_method` 選擇 provider 協議，例如
  [`openai_chat_completions`](https://developers.openai.com/api/reference/chat-completions/overview)、
  [`openai_responses`](https://developers.openai.com/api/reference/responses/overview)，
  或 [`anthropic_messages`](https://platform.claude.com/docs/en/api/messages)。

### 自訂模型

如果想使用的模型不在內建清單中，請將它加入 `models.json`，然後透過
`config.toml` 綁定。

使用者級模型目錄：

- macOS/Linux: `~/.devo/models.json`
- Windows: `C:\Users\yourname\.devo\models.json`

專案級覆蓋也可以放在 `<workspace>/.devo/models.json`。
在 `models.json` 中，`provider` 是該模型的預設 wire API 中繼資料；實際端點仍由
`config.toml` 中的 `provider` 欄位選擇。

範例 `models.json` 條目：

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

然後從 model binding 中引用該 `slug`：

```toml
[model_bindings.my-coding-model-example]
enabled = true
model_slug = "my-coding-model"
provider = "my.provider"
model_name = "provider-specific-model-name"
display_name = "My Coding Model"
invocation_method = "openai_chat_completions"
```

## 常見問題

### 專案狀態如何？

Devo 仍處於 1.0 之前並在積極開發中。它已經適合本地評估、實驗和貢獻者使用；
公共 API 和配置仍可能變更。

### 支援哪些模型？

內建模型中繼資料目前覆蓋 Qwen、Kimi、MiniMax、GLM 和 DeepSeek 系列。
任何支援 OpenAI 相容 Chat Completions、OpenAI 相容 Responses 或
Anthropic Messages API 的模型端點，都可以透過 provider/model 綁定接入。

## 參與貢獻

專案仍處於早期階段，歡迎貢獻：

- 關於 client/server runtime、provider layer、safety model 和 TUI 的架構回饋。
- 文件和翻譯。
- Provider、model 和 wire API 覆蓋。
- 帶驗證命令和迴歸測試的聚焦修復。

請開啟 issue 或 pull request 討論變更。

## Star 歷史

<a href="https://www.star-history.com/?repos=7df-lab%2Fdevo&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=7df-lab/devo&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=7df-lab/devo&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=7df-lab/devo&type=date&legend=top-left" />
 </picture>
</a>

## 授權

本專案採用 [MIT License](./LICENSE) 授權。

---

**如果你覺得 Devo 有用，請考慮給它一個 star。**
