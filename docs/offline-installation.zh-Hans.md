# 离线安装

[English](./offline-installation.md) | [简体中文](./offline-installation.zh-Hans.md) | [繁體中文](./offline-installation.zh-Hant.md) | [日本語](./offline-installation.ja.md) | [Русский](./offline-installation.ru.md)

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
