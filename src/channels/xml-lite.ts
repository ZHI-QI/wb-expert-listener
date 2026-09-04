/**
 * xml-lite.ts — 零依赖极简 XML 解析（微信回调格式：扁平 XML，一层节点）。
 * 先剥掉外层 <xml>，再逐节点非贪婪匹配（支持 CDATA 与明文）。
 */
export async function parseStringPromise(xml: string): Promise<Record<string, string[]>> {
  const inner = xml.replace(/^[\s\S]*?<xml[^>]*>/, "").replace(/<\/xml>\s*$/, "");
  const out: Record<string, string[]> = {};
  const re = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const tag = m[1];
    let val = m[2];
    const cdata = val.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
    if (cdata) val = cdata[1];
    (out[tag] ??= []).push(val);
  }
  return out;
}
