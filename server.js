/* =====================================================================
   سيرفر بلاغ الحملة القومية للتطعيم
   ---------------------------------------------------------------------
   • بيخدم صفحات الموقع (index / unit / admin) + ملفات الخط والقالب
   • وبيخزّن «شيت اليوم السابق» وبلاغات الوحدات في مجلد data/ على السيرفر
     عشان كل الأجهزة تشوف نفس البيانات (مش localStorage).
   • تشغيل:  node server.js
   • متغيرات بيئة اختيارية:
       PORT       (افتراضي 3000)
       ADMIN_KEY  كلمة سر رفع الشيت (لو فاضية = مفتوح لأي حد)
       DATA_DIR   مكان التخزين (افتراضي ./data)
   • الوضع الافتراضي: الإدارة فقط هي اللي بترفع، واليوزرز بيقرأوا بس
     ويطلّعوا PDF من غير ما يتخزن لهم أي حاجة على السيرفر.
     لو عايز تسمح للوحدات ترفع بلاغاتها للسيرفر: ALLOW_UNIT_WRITES=on
   ===================================================================== */
const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const PORT      = process.env.PORT || 3000;
const ROOT      = __dirname;
const DATA_DIR  = process.env.DATA_DIR || path.join(ROOT, "data");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
/* الوضع الافتراضي "off" = مفيش أي بيانات من اليوزرز بتتخزن على السيرفر.
   الوحدات بتقرأ شيت الإدارة وتطلّع PDF، وخلاص. */
const UNIT_WRITES = (process.env.ALLOW_UNIT_WRITES || "off").toLowerCase() === "on";
const MAX_BODY  = 8 * 1024 * 1024;   // 8MB

const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",   ".json":"application/json; charset=utf-8",
  ".ttf":"font/ttf", ".woff2":"font/woff2", ".png":"image/png", ".jpg":"image/jpeg",
  ".svg":"image/svg+xml", ".txt":"text/plain; charset=utf-8", ".ico":"image/x-icon"
};

/* ---------- تخزين على الديسك ---------- */
function ensureDirs(){
  fs.mkdirSync(DATA_DIR, {recursive:true});
  fs.mkdirSync(path.join(DATA_DIR,"units"), {recursive:true});
}
function readJson(file, fallback){
  try{ return JSON.parse(fs.readFileSync(file,"utf8")); }catch(e){ return fallback; }
}
function writeJson(file, obj){
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), "utf8");
  fs.renameSync(tmp, file);          // كتابة آمنة (مش بيسيب ملف نصه)
}
const baselineFile = () => path.join(DATA_DIR,"baseline.json");
const unitsFile = d => path.join(DATA_DIR,"units", String(d).replace(/[^\d\-]/g,"") + ".json");
const histFile  = d => path.join(DATA_DIR,"baseline-" + String(d).replace(/[^\d\-]/g,"") + ".json");

/* ---------- مساعدات HTTP ---------- */
function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,x-admin-key");
  res.setHeader("Cache-Control","no-store");
}
function send(res, code, obj){
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8","Content-Length":body.length});
  res.end(body);
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let size=0; const chunks=[];
    req.on("data", c=>{ size+=c.length; if(size>MAX_BODY){ reject(new Error("الملف أكبر من الحد المسموح (8MB)")); req.destroy(); } else chunks.push(c); });
    req.on("end", ()=>{
      try{ resolve(chunks.length? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch(e){ reject(new Error("JSON غير صالح")); }
    });
    req.on("error", reject);
  });
}
function isAdmin(req){
  if(!ADMIN_KEY) return true;                 // مفيش كلمة سر متظبطة
  let got = req.headers["x-admin-key"] || "";
  try{ got = decodeURIComponent(got); }catch(e){}
  if(got.length !== ADMIN_KEY.length) return false;
  // مقارنة ثابتة الزمن (تمنع تخمين الكلمة حرف حرف)
  let diff = 0;
  for(let i=0;i<got.length;i++) diff |= got.charCodeAt(i) ^ ADMIN_KEY.charCodeAt(i);
  return diff === 0;
}

/* ---------- خدمة الملفات الثابتة ---------- */
function serveStatic(req, res, pathname){
  let rel = decodeURIComponent(pathname);
  if(rel === "/" || rel === "") rel = "/index.html";
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ""));
  if(!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(file, (err, st)=>{
    if(err || !st.isFile()){
      res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"});
      return res.end("مش موجود: " + rel);
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {"Content-Type":type, "Content-Length":st.size, "Cache-Control":"no-cache"});
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- السيرفر ---------- */
ensureDirs();

const server = http.createServer(async (req, res)=>{
  cors(res);
  const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = u.pathname;

  if(req.method === "OPTIONS"){ res.writeHead(204); return res.end(); }

  try{
    /* صحة السيرفر */
    if(p === "/api/health"){
      return send(res, 200, {ok:true, server:true, time:new Date().toISOString(),
                             adminRequired: !!ADMIN_KEY,
                             unitWrites: UNIT_WRITES,
                             readOnly: !UNIT_WRITES,
                             name: os.hostname(), dataDir: DATA_DIR});
    }

    /* ---------- شيت اليوم السابق ---------- */
    if(p === "/api/baseline" && req.method === "GET"){
      const b = readJson(baselineFile(), null);
      if(!b) return send(res, 200, {date:"", units:{}, empty:true});
      return send(res, 200, b);
    }

    if(p === "/api/baseline" && req.method === "POST"){
      if(!isAdmin(req)) return send(res, 401, {error:"كلمة سر الإدارة غلط أو مطلوبة"});
      const body = await readBody(req);
      if(!body || !body.units || typeof body.units !== "object")
        return send(res, 400, {error:"البيانات لازم تحتوي على units"});
      const n = Object.keys(body.units).length;
      if(n === 0) return send(res, 400, {error:"مفيش وحدات في الملف"});

      const saved = Object.assign({}, body, {
        savedAt: new Date().toISOString(),
        savedBy: req.headers["x-user"] || "admin",
        unitsCount: n
      });
      writeJson(baselineFile(), saved);
      if(saved.date) writeJson(histFile(saved.date), saved);   // نسخة تاريخية
      console.log(`[baseline] اتحفظ ${n} وحدة بتاريخ ${saved.date||"؟"} من ${req.socket.remoteAddress}`);
      return send(res, 200, {ok:true, unitsCount:n, date:saved.date, savedAt:saved.savedAt});
    }

    /* ---------- بلاغات الوحدات ---------- */
    if(p === "/api/reports" && req.method === "GET"){
      const date = (u.searchParams.get("date") || "").trim();
      if(!date) return send(res, 400, {error:"لازم تحدد التاريخ"});
      const map = readJson(unitsFile(date), {});
      return send(res, 200, {date, units:map, count:Object.keys(map).length});
    }

    if(p === "/api/reports" && req.method === "POST"){
      /* في الوضع الافتراضي القراءة فقط: مفيش بلاغات وحدات بتتخزن على السيرفر */
      if(!UNIT_WRITES && !isAdmin(req)){
        return send(res, 403, {error:"السيرفر في وضع القراءة فقط — الإدارة هي اللي بترفع الشيت، والوحدات بتنزّل PDF من غير رفع.",
                               readOnly:true});
      }
      const body = await readBody(req);
      const date = String(body.date||"").trim();
      const unit = String(body.unit||"").trim();
      if(!date || !unit) return send(res, 400, {error:"لازم unit و date"});
      const file = unitsFile(date);
      const map = readJson(file, {});
      map[unit] = Object.assign({}, body, {savedAt:new Date().toISOString(),
                                            from:req.socket.remoteAddress});
      writeJson(file, map);
      console.log(`[report] ${unit} — ${date} (إجمالي ${Object.keys(map).length} وحدة)`);
      return send(res, 200, {ok:true, count:Object.keys(map).length});
    }

    if(p === "/api/reports" && req.method === "DELETE"){
      if(!isAdmin(req)) return send(res, 401, {error:"كلمة سر الإدارة غلط أو مطلوبة"});
      const date = (u.searchParams.get("date")||"").trim();
      const unit = (u.searchParams.get("unit")||"").trim();
      if(!date) return send(res, 400, {error:"لازم تحدد التاريخ"});
      const file = unitsFile(date);
      if(unit){
        const map = readJson(file, {}); delete map[unit]; writeJson(file, map);
        return send(res, 200, {ok:true, deleted:unit, count:Object.keys(map).length});
      }
      try{ fs.unlinkSync(file); }catch(e){}
      return send(res, 200, {ok:true, deleted:"all"});
    }

    /* ---------- قائمة الأيام اللي فيها بيانات (للإدارة) ---------- */
    if(p === "/api/days"){
      const dir = path.join(DATA_DIR,"units");
      let files = [];
      try{ files = fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f=>f.replace(".json","")); }catch(e){}
      files.sort().reverse();
      return send(res, 200, {days:files});
    }

    /* ---------- غير كده: ملفات الموقع ---------- */
    if(req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, p);
    return send(res, 405, {error:"Method not allowed"});

  }catch(err){
    console.error("[error]", err.message);
    return send(res, 500, {error: err.message || "خطأ في السيرفر"});
  }
});

server.listen(PORT, "0.0.0.0", ()=>{
  const nets = os.networkInterfaces();
  const ips = [];
  Object.values(nets).forEach(arr => (arr||[]).forEach(n => { if(n.family==="IPv4" && !n.internal) ips.push(n.address); }));
  console.log("=========================================================");
  console.log(" بلاغ الحملة القومية للتطعيم — السيرفر شغال");
  console.log("---------------------------------------------------------");
  console.log(" على نفس الجهاز :", `http://localhost:${PORT}/`);
  ips.forEach(ip => console.log(" على الشبكة      :", `http://${ip}:${PORT}/`));
  console.log(" التخزين        :", DATA_DIR);
  console.log(" كلمة سر الإدارة :", ADMIN_KEY ? "مفعّلة" : "مفتوحة (مفيش ADMIN_KEY)");
  console.log("=========================================================");
});
