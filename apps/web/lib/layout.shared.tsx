import { i18n } from "@/lib/i18n";
import { i18nProvider, uiTranslations } from "fumadocs-ui/i18n";

export const docsTranslations = i18n
  .translations()
  .extend(uiTranslations())
  .add("ui", {
    en: {
      displayName: "English",
    },
    zh: {
      displayName: "中文",
      search: "搜索文档",
      searchNoResult: "没有找到结果",
      toc: "本页目录",
      tocNoHeadings: "没有标题",
      tocInline: "目录",
      chooseLanguage: "选择语言",
      nextPage: "下一页",
      previousPage: "上一页",
      chooseTheme: "主题",
      themeToggle: "切换主题",
      themeLight: "浅色",
      themeDark: "深色",
      themeSystem: "跟随系统",
      codeBlockCopy: "复制文本",
      codeBlockCopied: "已复制",
      headingCopyAnchor: "复制锚点链接",
      menuToggle: "切换菜单",
      sidebarOpen: "打开侧边栏",
      sidebarCollapse: "收起侧边栏",
      notFoundTitle: "页面不存在",
      notFoundDescription: "你访问的页面可能已被删除、改名，或暂时不可用。",
      notFoundLink: "返回首页",
    },
  });

export function docsI18nProvider(locale: string) {
  return i18nProvider(docsTranslations, locale);
}

export function docsLocalePath(locale: string, pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const hasLocalePrefix = i18n.languages.includes(
    segments[0] as (typeof i18n.languages)[number],
  );
  const rest = hasLocalePrefix ? segments.slice(1) : segments;

  if (locale === i18n.defaultLanguage) {
    return `/${rest.join("/")}`;
  }

  return `/${[locale, ...rest].join("/")}`;
}
