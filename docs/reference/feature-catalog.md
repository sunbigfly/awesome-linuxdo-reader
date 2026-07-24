---
title: 功能覆盖目录
description: 查看当前版本所有用户可见功能、唯一编号、状态、验证日期和对应手册。
feature_ids: ["REF-002"]
source_anchors: ["@version"]
since: 0.1.2
version: 0.1.4
status: current
last_verified: 2026-07-24
screenshots: ["/screenshots/guide-22-feature-catalog.png"]
---

<script setup>
import { withBase } from 'vitepress'
import catalog from '../public/feature-catalog.json'

const grouped = catalog.reduce((result, feature) => {
  ;(result[feature.category] ||= []).push(feature)
  return result
}, {})
const docLink = (document) => withBase(`/${document.replace(/\.md$/, '')}`)
</script>

# 功能覆盖目录

本目录由 `docs/public/feature-catalog.json` 驱动，是“当前功能是否已经写入手册”的事实表。每项都有唯一编号、源码锚点、首次纳入目录版本、当前版本、状态、验证日期、截图和至少一篇对应文档。

![线上功能覆盖目录中的功能数量、分类、源码锚点和手册入口](/screenshots/guide-22-feature-catalog.png)

<p class="image-caption">目录按分类展示 94 项当前能力，每项都可以回到对应手册页面。</p>

<div class="doc-meta">
  <span>{{ catalog.length }} 项功能</span>
  <span>{{ Object.keys(grouped).length }} 个分类</span>
  <span>当前版本 0.1.4</span>
  <span>核验日期 2026-07-24</span>
</div>

<section v-for="(features, category) in grouped" :key="category" class="catalog-section">
  <h2>{{ category }}</h2>
  <div class="catalog-table">
    <article v-for="feature in features" :key="feature.feature_id" class="catalog-row">
      <code>{{ feature.feature_id }}</code>
      <div>
        <strong>{{ feature.title }}</strong>
        <p>{{ feature.description }}</p>
        <small>
          <span>状态：{{ feature.status }}</span>
          <span>源码：<code>{{ feature.source_anchor }}</code></span>
          <span>验证：{{ feature.last_verified }}</span>
        </small>
      </div>
      <a :href="docLink(feature.docs[0])">查看手册</a>
    </article>
  </div>
</section>

## 覆盖口径

- 目录面向用户可见入口、操作、设置、数据行为、监控和故障恢复；不为每个内部辅助函数建立独立条目。
- 一个复合功能可以在多篇手册出现，但必须有一个稳定 `feature_id`。
- `source_anchor` 使用当前源码中的稳定符号或唯一控件标记，不使用易漂移行号。
- `since` 表示首次纳入可验证目录的版本；早期实现历史未确认时不反推版本。
- 自动校验要求未文档化功能和无来源项均为 0。

机器可读版本：[feature-catalog.json](https://github.com/sunbigfly/awesome-linuxdo-reader/blob/main/docs/public/feature-catalog.json)。
