/**
 * 界面文案集中地（SRS 3.5 编码约定）。
 * 所有用户可见文案写在这里；组件内禁止散落硬编码中文。
 * 来源：SRS 表 7-5 关键文案。
 */
export const copy = {
  app: {
    name: "减重提醒",
  },
  empty: {
    noWeight: "还没有记录，先称一次吧。",
    noReview: "上周还没有足够记录，先去记两天。",
  },
  weather: {
    unavailable: "天气暂时不可用，本周先按室内安排。",
    stale: (time: string) => `天气服务暂时不可用，正在使用 ${time} 的缓存数据。`,
    cityRequired: "请先搜索并选择城市，天气与周计划需要城市信息。",
    searchFailed: "城市搜索暂时不可用，请稍后重试。",
    retry: "重新获取天气",
  },
  plan: {
    empty: "还没有本周计划，点击「生成计划」开始。",
    regenerate: "生成 / 重新生成",
    statusOk: "计划规则校验通过",
  },
  diet: {
    disclaimer: "以上为估算值，仅供日常参考，不承诺疗效；如有疾病或用药，请遵医嘱。",
    noProfile: "请先完善档案与目标，再查看饮食建议。",
  },
  ai: {
    notConfigured: "AI 还没启用，去设置里选一个服务商。",
    failed: "这次没拿到结果，已用本地版本代替。",
  },
  pdf: {
    noText: "这份 PDF 没有可提取的文字，暂不支持图片。",
  },
  user: {
    deleteConfirm: (name: string) =>
      `将删除「${name}」的全部记录，且无法恢复。请输入姓名确认。`,
  },
  db: {
    saveFailed: "数据未保存，请重试。输入已保留。",
  },
} as const;
