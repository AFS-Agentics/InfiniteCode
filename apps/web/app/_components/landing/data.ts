import type { Locale } from "@/lib/locale";

export { localeCookieName, supportedLocales, type Locale } from "@/lib/locale";

export const installCommands = {
  unix:
    "curl -fsSL https://raw.githubusercontent.com/7df-lab/devo/main/install.sh | sh",
  windows:
    "curl.exe -fsSL https://raw.githubusercontent.com/7df-lab/devo/main/install.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -Command -",
  source: "git clone https://github.com/7df-lab/devo.git\ncd devo\ncargo build --release",
} as const;

export type InstallId = keyof typeof installCommands;

export const landingCopy = {
  en: {
    language: {
      label: "Language",
      en: "EN",
      zh: "中文",
    },
    nav: {
      docs: "Docs",
      install: "Install",
      contact: "Contact",
      github: "GitHub",
    },
    hero: {
      badge: "Early-stage coding agent",
      body: "An open coding agent for developers who want command-line speed, provider flexibility, and an inspectable alternative to closed agent workflows.",
      primaryCta: "Install Devo",
      secondaryCta: "Read docs",
      metrics: [
        ["Open", "source"],
        ["CLI", "first"],
        ["Docs", "ready"],
      ],
    },
    proofRows: [
      {
        eyebrow: "Command-line native",
        title: "Fast where developers already work",
        body: "Devo keeps the primary loop in the terminal: inspect, edit, run, and steer without switching contexts.",
      },
      {
        eyebrow: "Provider flexible",
        title: "Bring the model stack that fits the job",
        body: "The project is designed around open, inspectable configuration instead of locking the workflow to one vendor.",
      },
      {
        eyebrow: "Open source",
        title: "A coding agent you can audit and shape",
        body: "Read the runtime, follow the decisions, and adapt the toolchain as the project grows.",
      },
    ],
    workflow: {
      kicker: "Built for the working loop",
      title: "Agent work should feel close to the code, not above it.",
      body: "Devo keeps the interaction surface compact and direct: the command line stays visible, project context stays inspectable, and every run remains something a developer can reason about.",
      imageAlt: "Devo command-line visual style",
      noteLabel: "Current loop",
      noteLines: [
        "$ devo",
        "inspect context",
        "plan edits",
        "apply changes",
        "verify with commands",
      ],
    },
    install: {
      kicker: "Install",
      title: "Start from the terminal.",
      body: "Pick your platform, copy the command, then keep the docs open for setup and configuration.",
      docs: "Documentation",
      github: "GitHub",
      terminalTitle: "devo install",
      tabAria: "Install options",
      copy: "Copy",
      copied: "Copied",
      tabs: {
        unix: "macOS / Linux",
        windows: "Windows",
        source: "Source",
      },
    },
    closing: {
      kicker: "Follow the project",
      title: "Open, early, and moving quickly.",
      bodyBeforeEmail:
        "Devo is under active development. For funding, investment, recruiting, or general questions, contact",
      locationLabel: "Location",
      location: "Beijing, China",
      openDocs: "Open docs",
      viewGithub: "View GitHub",
    },
  },
  zh: {
    language: {
      label: "语言",
      en: "EN",
      zh: "中文",
    },
    nav: {
      docs: "文档",
      install: "安装",
      contact: "联系",
      github: "GitHub",
    },
    hero: {
      badge: "早期阶段的编码代理",
      body: "Devo 是面向开发者的开源编码代理，保留命令行速度、灵活的模型提供方配置，以及可检查的代理工作流。",
      primaryCta: "安装 Devo",
      secondaryCta: "阅读文档",
      metrics: [
        ["开源", "可检查"],
        ["CLI", "优先"],
        ["文档", "就绪"],
      ],
    },
    proofRows: [
      {
        eyebrow: "命令行原生",
        title: "在开发者工作的地方保持高效",
        body: "Devo 将主要循环保留在终端中：检查上下文、编辑、运行，并在不切换场景的情况下持续控制任务。",
      },
      {
        eyebrow: "提供方灵活",
        title: "按任务选择合适的模型栈",
        body: "项目围绕开放、可检查的配置设计，而不是把工作流绑定到单一供应商。",
      },
      {
        eyebrow: "开源",
        title: "可以审计和塑造的编码代理",
        body: "你可以阅读运行时、跟踪设计决策，并随着项目发展调整自己的工具链。",
      },
    ],
    workflow: {
      kicker: "为真实工作循环构建",
      title: "代理工作应该贴近代码，而不是悬在代码之上。",
      body: "Devo 让交互界面保持紧凑直接：命令行始终可见，项目上下文可检查，每一次运行都能被开发者理解。",
      imageAlt: "Devo 命令行视觉风格",
      noteLabel: "当前循环",
      noteLines: [
        "$ devo",
        "检查上下文",
        "规划修改",
        "应用变更",
        "运行验证命令",
      ],
    },
    install: {
      kicker: "安装",
      title: "从终端开始。",
      body: "选择你的平台，复制安装命令，并在配置过程中保持文档可见。",
      docs: "文档",
      github: "GitHub",
      terminalTitle: "devo install",
      tabAria: "安装选项",
      copy: "复制",
      copied: "已复制",
      tabs: {
        unix: "macOS / Linux",
        windows: "Windows",
        source: "源码构建",
      },
    },
    closing: {
      kicker: "关注项目",
      title: "开放、早期，并且快速迭代。",
      bodyBeforeEmail:
        "Devo 正在积极开发中。如需资助、投资、招聘或一般咨询，请联系",
      locationLabel: "所在地",
      location: "Beijing, China",
      openDocs: "打开文档",
      viewGithub: "查看 GitHub",
    },
  },
} as const;

export type LandingCopy = (typeof landingCopy)[Locale];
