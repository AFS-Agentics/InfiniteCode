# 離線安裝

[English](./offline-installation.md) | [简体中文](./offline-installation.zh-Hans.md) | [繁體中文](./offline-installation.zh-Hant.md) | [日本語](./offline-installation.ja.md) | [Русский](./offline-installation.ru.md)

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
