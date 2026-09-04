/**
 * web.ts — OKF 上传转化：本地单文件 HTML 页面 + 上传 API（仅 127.0.0.1）。
 * 上传 → 调 ingest_okf.py（脚本库执行）→ 返回生成的 concept 清单。
 */
import express, { type Request, type Response, type Express } from "express";
import { getConfig } from "../config.js";
import { callScript } from "../scripts-lib/scriptlib.js";
import { newTraceId, traceLogger } from "../log/logger.js";
import { appendChatLog } from "../log/store.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

export function mountWeb(app: Express): void {
  const cfg = getConfig();

  // 上传表单 API
  app.post("/api/okf/upload", async (req: Request, res: Response) => {
    const traceId = newTraceId();
    const log = traceLogger(traceId, { scope: "okf-upload" });
    try {
      // 简化处理：JSON 提交（前端读文件为 base64）
      const { filename, base64, type, title, tags } = req.body as {
        filename: string; base64: string; type: string; title: string; tags?: string;
      };
      if (!filename || !base64 || !type || !title) {
        res.status(400).json({ error: "filename/base64/type/title required" });
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      if (![".docx", ".pdf", ".md", ".txt", ".markdown"].includes(ext)) {
        res.status(400).json({ error: `unsupported type: ${ext}` });
        return;
      }

      const tmpDir = mkdtempSync(path.join(tmpdir(), "wb-okf-up-"));
      try {
        const tmpFile = path.join(tmpDir, `upload${ext}`);
        writeFileSync(tmpFile, Buffer.from(base64, "base64"));

        const result = await callScript({
          name: "ingest_okf",
          args: ["--input", tmpFile, "--type", type, "--title", title, "--tags", tags ?? "", "--kb-dir", cfg.kb.okfDir],
        });

        appendChatLog({
          userId: "admin:local", channel: "web", role: "system",
          content: `OKF上传: ${filename} -> ${result.stdout.trim()}`, traceId,
        });

        if (!result.ok) {
          res.status(500).json({ error: result.stderr.slice(0, 1000) || "ingest failed", stdout: result.stdout });
          return;
        }
        res.json({ ok: true, detail: result.stdout.trim(), durationMs: result.durationMs });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (err) {
      log.error({ err }, "okf upload failed");
      res.status(500).json({ error: String(err) });
    }
  });

  // 单文件页面
  app.get("/okf", (_req, res) => {
    res.type("html").send(PAGE_HTML);
  });
}

const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>OKF 知识库上传</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:640px;margin:40px auto;padding:0 20px;background:#f7f8fa;color:#1a1a1a}
  h1{font-size:1.4rem}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  label{display:block;margin:12px 0 4px;font-size:.9rem;color:#374151}
  input[type=text],select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:.95rem}
  #drop{margin-top:16px;border:2px dashed #cbd5e1;border-radius:12px;padding:28px;text-align:center;color:#6b7280;cursor:pointer;transition:.15s}
  #drop.over{border-color:#3b82f6;background:#eff6ff}
  #file{display:none}
  button{margin-top:18px;width:100%;padding:11px;background:#2563eb;color:#fff;border:0;border-radius:8px;font-size:1rem;cursor:pointer}
  button:disabled{background:#93c5fd}
  #result{margin-top:14px;padding:10px;border-radius:8px;font-size:.88rem;white-space:pre-wrap;display:none}
  #ok{background:#ecfdf5;color:#065f46;display:none}
  #err{background:#fef2f2;color:#991b1b;display:none}
</style>
</head>
<body>
<h1>📚 OKF 知识库上传</h1>
<div class="card">
  <label>知识条目标题</label>
  <input id="title" type="text" placeholder="如：门店退货政策说明">
  <label>Concept 类型</label>
  <select id="type">
    <option value="FAQ">FAQ（常见问答）</option>
    <option value="Document">Document（文档）</option>
    <option value="Runbook">Runbook（操作手册）</option>
    <option value="Reference">Reference（参考资料）</option>
  </select>
  <label>标签（逗号分隔，可选）</label>
  <input id="tags" type="text" placeholder="faq, 退货">
  <div id="drop">点击或拖拽文件到此处<br><small>支持 docx / pdf / md / txt</small></div>
  <input id="file" type="file" accept=".docx,.pdf,.md,.txt,.markdown">
  <button id="btn" disabled>转换并入库</button>
  <div id="ok"></div><div id="err"></div>
</div>
<script>
const $=id=>document.getElementById(id);
let file=null;
const drop=$('drop'),fi=$('file');
drop.onclick=()=>fi.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');setFile(e.dataTransfer.files[0])};
fi.onchange=()=>setFile(fi.files[0]);
function setFile(f){if(!f)return;file=f;drop.textContent=f.name+'（'+(f.size/1024).toFixed(1)+' KB）';$('btn').disabled=false}
$('btn').onclick=async()=>{
  if(!file)return;
  $('btn').disabled=true;$('ok').style.display='none';$('err').style.display='none';
  const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(file)});
  try{
    const res=await fetch('/api/okf/upload',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({filename:file.name,base64:b64,type:$('type').value,title:$('title').value||file.name,tags:$('tags').value})});
    const data=await res.json();
    if(res.ok){$('ok').style.display='block';$('ok').textContent='✅ '+data.detail}
    else{$('err').style.display='block';$('err').textContent='❌ '+(data.error||'failed')}
  }catch(e){$('err').style.display='block';$('err').textContent='❌ '+e}
  $('btn').disabled=false;
};
</script>
</body>
</html>`;
