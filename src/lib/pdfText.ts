/**
 * PDF 文本层提取与隐私脱敏（SRS 9.4 / FR-REC-08/09）：
 * 只处理"文本型 PDF"，逐页 getTextContent 拼接；扫描件（无文本层）不调用 AI。
 * 硬性边界：不做 OCR、不做图片识别（SRS 0.4）。
 */
import { copy } from "@/lib/copy";

export const PDF_MAX_PAGES = 20;
export const PDF_MAX_CHARS = 50_000;
export const PDF_MIN_TEXT = 100;

/** 本地正则脱敏：身份证号、手机号、住址等明显个人信息（SRS 9.4 第 2 条）。姓名不强制去除但提示用户。 */
export function sanitizePdfText(raw: string): string {
  return raw
    // 18 位身份证（含末位 X）
    .replace(/\b\d{17}[\dXx]\b/g, "[身份证已隐去]")
    // 15 位旧身份证
    .replace(/\b\d{15}\b/g, "[证件号已隐去]")
    // 中国大陆手机号
    .replace(/\b1[3-9]\d{9}\b/g, "[手机号已隐去]")
    // 住址：省/市/区 + 详细到"号/室"
    .replace(/[\u4e00-\u9fa5]{2,8}(?:省|市|自治区)[\u4e00-\u9fa5]{2,10}(?:区|县|镇)[\u4e00-\u9fa5\d]{2,30}?(?:号|室|栋|单元)/g, "[住址已隐去]")
    // 邮箱
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[邮箱已隐去]");
}

export interface ExtractResult {
  text: string;
  /** 是否因页数/字符超限被截断 */
  truncated: boolean;
  /** 页数 */
  pages: number;
}

/** 截断处理（纯函数）：最多 20 页、5 万字符，超限截断并提示；返回给 AI 的文本已脱敏。 */
export function preparePdfText(pagesText: string[], sanitize = sanitizePdfText): ExtractResult {
  const pages = pagesText.length;
  const limited = pagesText.slice(0, PDF_MAX_PAGES);
  let text = sanitize(limited.join("\n"));
  let truncated = pages > PDF_MAX_PAGES;
  if (text.length > PDF_MAX_CHARS) {
    text = text.slice(0, PDF_MAX_CHARS);
    truncated = true;
  }
  return { text, truncated, pages };
}

/** 扫描件判定：文本长度 <100 字符即视为无文本层（SRS 9.4 第 4 条），不发 AI 请求。 */
export function isTextlessPdf(text: string): boolean {
  return text.trim().length < PDF_MIN_TEXT;
}

export const PDF_NO_TEXT_MESSAGE = copy.pdf.noText;

/**
 * 从 File 逐页提取文本层。pdfjs worker 用 Vite ?url 导入，避免打包后路径失效。
 * 仅做文本层读取，不含任何 OCR。
 */
export async function extractPdfFile(file: File): Promise<ExtractResult> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pagesText: string[] = [];
  // 只读取前 20 页，避免超大文档耗尽内存
  for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pagesText.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await doc.destroy();
  return preparePdfText(pagesText);
}
