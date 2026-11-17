export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "未知错误");
  // FR-APP-07：所有失败中文提示，不展示堆栈
  if (/key|permission|denied/i.test(message) && /credential|windows/i.test(message)) {
    return "系统凭据访问失败，请检查 Windows 凭据管理器权限。";
  }
  if (/database|sqlite|sql/i.test(message)) {
    return "数据未保存，请重试。输入已保留。";
  }
  if (/network|fetch|timeout|连接/i.test(message)) {
    return "网络连接不可用，已使用本地数据。";
  }
  return message.length > 80 ? "操作失败，请稍后重试。" : message;
}
