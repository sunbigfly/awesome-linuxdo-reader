import { defineConfig } from 'vitepress'
import { fileURLToPath } from 'node:url'

const repository = 'awesome-linuxdo-reader'
const base = process.env.DOCS_BASE || `/${repository}/`

export default defineConfig({
  lang: 'zh-CN',
  title: 'Awesome LinuxDo Reader',
  titleTemplate: ':title · 用户手册',
  description: 'Awesome LinuxDo Reader 正式用户手册：安装、阅读、互动、个性化、性能与故障排查。',
  base,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['README.md', 'INTRODUCTION.md', 'superpowers/**'],
  head: [
    ['link', { rel: 'icon', href: `${base}logo.png` }],
    ['meta', { name: 'theme-color', content: '#315f47' }],
  ],
  markdown: {
    headers: {
      level: [2, 3],
    },
  },
  vite: {
    publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
  },
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Awesome LinuxDo Reader',
    nav: [
      { text: '开始使用', link: '/getting-started/installation' },
      { text: '使用指南', link: '/guide/reading-modes' },
      { text: '设置', link: '/settings/overview' },
      { text: '维护与排障', link: '/manage/data-and-cache' },
      { text: '功能索引', link: '/reference/feature-catalog' },
      {
        text: 'v0.1.2',
        items: [
          { text: '更新记录', link: '/reference/changelog' },
          { text: '兼容性', link: '/reference/compatibility' },
        ],
      },
    ],
    sidebar: {
      '/getting-started/': [
        {
          text: '开始使用',
          items: [
            { text: '安装与更新', link: '/getting-started/installation' },
            { text: '五分钟上手', link: '/getting-started/quick-start' },
            { text: '界面总览', link: '/getting-started/interface-tour' },
          ],
        },
      ],
      '/guide/': [
        {
          text: '阅读',
          items: [
            { text: '阅读模式与工作区', link: '/guide/reading-modes' },
            { text: '楼层、时间轴与历史', link: '/guide/navigation' },
            { text: '楼中楼与上下文', link: '/guide/thread-context' },
            { text: '图片、媒体与富内容', link: '/guide/content-and-media' },
          ],
        },
        {
          text: '互动',
          items: [
            { text: '回复与社区操作', link: '/guide/community-actions' },
            { text: '消息、历史与收藏', link: '/guide/messages-and-collections' },
            { text: '用户资料与关系', link: '/guide/users' },
          ],
        },
      ],
      '/settings/': [
        {
          text: '设置中心',
          items: [
            { text: '设置中心总览', link: '/settings/overview' },
            { text: '01 · 用户信息', link: '/settings/user-info' },
            { text: '02 · 图片设置', link: '/settings/image' },
            { text: '03 · 字体设置', link: '/settings/font' },
            { text: '04 · 布局设置', link: '/settings/layout' },
            { text: '05 · 浮窗设置', link: '/settings/window' },
            { text: '06 · 外观设置', link: '/settings/appearance' },
            { text: '07 · 闪烁动效', link: '/settings/motion' },
            { text: '08 · 性能设置', link: '/settings/performance' },
            { text: '09 · 资源监控', link: '/settings/resource-monitor' },
            { text: '10 · 请求数据', link: '/settings/request-data' },
            { text: '11 · 其他功能', link: '/settings/other' },
            { text: '12 · 数据管理', link: '/settings/data-management' },
            { text: '13 · 关于', link: '/settings/about' },
          ],
        },
        {
          text: '专题与参考',
          items: [
            { text: '图片与字体专题', link: '/settings/images-and-fonts' },
            { text: '布局、浮窗与外观专题', link: '/settings/layout-and-appearance' },
            { text: '动效与其他功能专题', link: '/settings/motion-and-other' },
            { text: '完整设置参考', link: '/settings/reference' },
          ],
        },
      ],
      '/manage/': [
        {
          text: '维护与排障',
          items: [
            { text: '数据、配置与缓存', link: '/manage/data-and-cache' },
            { text: '资源与请求监控', link: '/manage/monitoring' },
            { text: '隐私、权限与边界', link: '/manage/privacy-and-permissions' },
            { text: '故障排查', link: '/manage/troubleshooting' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '功能覆盖目录', link: '/reference/feature-catalog' },
            { text: '兼容性', link: '/reference/compatibility' },
            { text: '更新记录', link: '/reference/changelog' },
            { text: '文档维护规范', link: '/reference/documentation' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            noResultsText: '没有找到相关内容',
            resetButtonTitle: '清除查询',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },
    outline: {
      level: [2, 3],
      label: '本页目录',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/sunbigfly/awesome-linuxdo-reader' },
    ],
    editLink: {
      pattern: 'https://github.com/sunbigfly/awesome-linuxdo-reader/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到明亮模式',
    darkModeSwitchTitle: '切换到暗色模式',
    footer: {
      message: '非 LINUX DO 官方项目。站点数据与互动结果以原站为准。',
      copyright: 'Released under the MIT License.',
    },
  },
})
