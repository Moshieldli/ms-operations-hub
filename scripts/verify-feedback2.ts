/** Verify rev-49 feedback upgrades live: screenshot+markup, required name, by-submitter filter. */
import { withBrowser } from "./lib/livecheck";
const BASE=process.argv[2]||"http://localhost:3111";
(async()=>{
  const stamp=Date.now(); const marker=`E2E markup test ${stamp}`; const who=`Bot ${stamp%1000}`;
  const fails:string[]=[];
  await withBrowser(async b=>{
    const p=await b.newPage({viewport:{width:1280,height:900}});
    await p.goto(`${BASE}/sales`,{waitUntil:"domcontentloaded",timeout:60000});
    await p.waitForTimeout(2500);
    await p.locator('button[aria-label="Send feedback"]').click();
    await p.waitForTimeout(400);
    // two attach buttons present
    const attachFile=await p.locator('button:has-text("Attach file")').count();
    const shot=await p.locator('button:has-text("Take screenshot")').count();
    if(attachFile!==1)fails.push("Attach file button missing");
    if(shot!==1)fails.push("Take screenshot button missing");
    // required name: type body, no name, Send -> blocked
    await p.locator("textarea").first().fill(marker);
    // clear name field in case localStorage prefilled
    const nameInput=p.locator('input[placeholder="Your name (required)"]');
    await nameInput.fill("");
    await p.locator('button:has-text("Send")').click();
    await p.waitForTimeout(400);
    const bodyText1=await p.evaluate(()=>document.body.innerText);
    if(!/add your name/i.test(bodyText1))fails.push("name-required not enforced");
    // Take screenshot -> markup overlay
    await nameInput.fill(who);
    await p.locator('button:has-text("Take screenshot")').click();
    await p.waitForTimeout(4000); // html2canvas
    const markup=await p.locator('button:has-text("Attach"):visible').count();
    const markupTools=await p.evaluate(()=>document.body.innerText.includes("Markup:"));
    if(!markupTools)fails.push("markup overlay did not appear after screenshot");
    else{
      // draw a stroke on the draw canvas
      const canvas=p.locator('canvas').last();
      const box=await canvas.boundingBox();
      if(box){await p.mouse.move(box.x+box.width*0.3,box.y+box.height*0.3);await p.mouse.down();await p.mouse.move(box.x+box.width*0.6,box.y+box.height*0.5);await p.mouse.up();}
      await p.locator('button:has-text("Attach")').last().click();
      await p.waitForTimeout(800);
    }
    // image preview should now be present
    const preview=await p.locator('img[alt="attachment preview"]').count();
    if(preview<1)fails.push("no image preview after markup attach");
    // submit
    await p.locator('button:has-text("Send")').click();
    await p.waitForTimeout(1500);
    const done=await p.evaluate(()=>document.body.innerText.includes("Thanks"));
    if(!done)fails.push("submit did not complete");
    // requests page: item + by-submitter filter with the name
    await p.goto(`${BASE}/requests`,{waitUntil:"domcontentloaded",timeout:60000});
    await p.waitForTimeout(2500);
    const rt=await p.evaluate(()=>document.body.innerText);
    if(!rt.includes(marker))fails.push("feedback not on /requests");
    if(!rt.includes(who))fails.push("submitter name not on /requests");
    if(!/By submitter/i.test(rt))fails.push("by-submitter filter missing");
    console.log("attach buttons:",attachFile,shot,"| markup appeared:",markupTools,"| preview:",preview,"| done:",done);
    await p.close();
  });
  if(fails.length){console.log("\n=== FEEDBACK2 VERIFY FAIL ===");fails.forEach(f=>console.log(" x "+f));process.exit(1);}
  console.log("\n=== FEEDBACK2 VERIFY PASS ===");
})();
