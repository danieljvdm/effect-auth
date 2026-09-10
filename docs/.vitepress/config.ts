import { defineConfig } from "vitepress";

import tokyoNightLight from "./theme/tokyo-night-light.json";

export default defineConfig({
  title: "Effect Auth",
  description: "Composable authentication, sessions, and identity workflows for Effect.",
  cleanUrls: true,
  markdown: {
    theme: { light: { ...tokyoNightLight, type: "light" }, dark: "tokyo-night" },
  },
  themeConfig: {
    siteTitle: "Effect Auth",
    nav: [
      { text: "Guide", link: "/guide/authentication" },
      { text: "Toolchain", link: "/TOOLCHAIN" },
    ],
    sidebar: [
      {
        text: "Effect Auth",
        items: [
          { text: "Authentication", link: "/guide/authentication" },
          { text: "Toolchain", link: "/TOOLCHAIN" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/danieljvdm/effect-auth" }],
    search: { provider: "local" },
    editLink: { pattern: "https://github.com/danieljvdm/effect-auth/edit/main/docs/:path" },
  },
});
