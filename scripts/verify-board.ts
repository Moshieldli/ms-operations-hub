import { withBrowser } from "./lib/livecheck";
const BASE=process.argv[2]||"http://localhost:3111";
const EMOJI=/[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/gu;
(async()=>{const fails:string[]=[];
 await withBrowser(async b=>{
  const p=await b.newPage({viewport:{width:1920,height:1080}});
  await p.goto(`${BASE}/tv/board`,{waitUntil:"domcontentloaded",timeout:60000});
  await p.waitForTimeout(3500);
  const t=await p.evaluate(()=>document.body.innerText);
  const em=[...new Set(t.match(EMOJI)||[])];
  if(em.length)fails.push("emoji: "+em.join(" "));
  const svgs=await p.evaluate(()=>document.querySelectorAll("svg").length);
  if(svgs<3)fails.push(`only ${svgs} svgs`);
  const cols=await p.evaluate(()=>document.querySelectorAll(".grid-cols-5 > div").length);
  if(cols!==5)fails.push(`expected 5 day columns, got ${cols}`);
  const over=await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1||document.documentElement.scrollHeight>document.documentElement.clientHeight+1);
  if(over)fails.push("document overflows 1080p");
  if(!/Route Board/.test(t))fails.push("no title");
  if(!/stops/.test(t))fails.push("no stops rendered");
  console.log("day columns:",cols,"| svgs:",svgs,"| emoji:",em.length,"| overflow:",over);
  console.log("--- first 500 chars ---"); console.log(t.slice(0,500).replace(/\n{2,}/g,"\n"));
  await p.screenshot({path:"scratch-board.png"});
  await p.close();});
 if(fails.length){console.log("\n=== BOARD VERIFY FAIL ===");fails.forEach(f=>console.log(" x "+f));process.exit(1);}
 console.log("\n=== BOARD VERIFY PASS ===");
})();
