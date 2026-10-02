import { test, expect } from "@playwright/test";

// This is an isolated rendered product fixture. The UI, coordinator, sealed-box
// provisioning and RPC adapter are real; the server responses are synthetic.
// Database authority/locking is exercised separately by the PostgreSQL suite.
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#17191d;color:#e8e9ec;font:14px system-ui}button,input,select{font:inherit}button{padding:8px;margin:3px}code{font-size:12px}#root{max-width:720px;margin:20px auto;padding:20px;border:1px solid #454850}:root{--text-secondary:#c7c9d0;--text-xs:12px;--text-sm:14px}input,select{padding:7px;min-width:0;max-width:100%;box-sizing:border-box}
</style></head><body><div id="root"></div><script type="module">
import React from "/node_modules/.vite/deps/react.js";
import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";
import sodium from "/node_modules/.vite/deps/libsodium-wrappers.js";
import RefreshRuntime from "/@react-refresh";
import {createHostedMobileSyncCoordinator} from "/src/mobileSync/hostedCoordinator.ts";
import {createMobileProjectKeyProvisioningService} from "/src/mobileSync/projectKeyProvisioning.ts";
import {SupabaseMobileSyncTransport} from "/src/mobileSync/supabaseTransport.ts";
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {TrustedDevicesPanel}=await import("/src/components/panel/TrustedDevicesPanel.tsx");
await sodium.ready;
const desktop='10000000-0000-4000-8000-000000000001',phone='10000000-0000-4000-8000-000000000002';
const book='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const account='30000000-0000-4000-8000-000000000001';
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const pair=sodium.crypto_box_keypair();const phonePair=sodium.crypto_box_keypair();
const digest=async b=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',b)));
const rows=await Promise.all([[desktop,pair.publicKey,'desktop'],[phone,phonePair.publicKey,'ios']].map(async([id,key,platform],i)=>({device_id:id,user_id:account,platform,key_id:'40000000-0000-4000-8000-00000000000'+(i+1),key_version:1,key_algorithm:'x25519-v1',public_key:'\\\\x'+hex(key),public_key_sha256:await digest(key),project_enrolled_at:'2026-10-02T00:00:00Z',project_revoked_at:null})));
const states={[book]:{version:3,active:3},[other]:{version:1,active:1}};
const events=[];let pauseRevoke=false,release=null;let drift=false;
window.fixture={events,pause(){pauseRevoke=true},release(){release?.()},drift(){drift=true}};
const token=btoa('{}')+'.'+btoa(JSON.stringify({role:'authenticated',sub:account,device_id:desktop}))+'.synthetic';
function coordinator(projectId){
 const transport=new SupabaseMobileSyncTransport({supabaseUrl:'https://synthetic.invalid',publishableKey:'fixture',userAccessToken:token,deviceId:desktop,fetch:async(url,init)=>{
  const name=String(url).split('/').pop(),args=JSON.parse(init.body);events.push({name,args});const state=states[projectId];let result;
  if(name==='mobile_get_project_key_state')result={project_id:projectId,latest_key_version:state.version,active_key_version:state.active};
  else if(name==='mobile_list_project_devices')result=rows;
  else if(name==='mobile_revoke_project_device'){
   if(pauseRevoke)await new Promise(resolve=>{release=resolve});pauseRevoke=false;
   const target=rows.find(row=>row.device_id===args.p_target_device_id);target.project_revoked_at='2026-10-02T01:00:00Z';state.active=null;
   result={project_id:projectId,device_id:target.device_id,revoked_at:target.project_revoked_at,revoked_by_device_id:desktop,revocation_reason_code:args.p_reason_code};
  }else if(name==='mobile_rotate_project_key_with_envelopes'){
   if(drift){drift=false;state.version++;state.active=state.version;return new Response('{}',{status:409})}
   if(args.p_expected_previous_version!==state.version)return new Response('{}',{status:409});
   const actual=rows.filter(row=>!row.project_revoked_at).map(row=>row.device_id+':'+row.key_id).sort();const supplied=args.p_envelopes.map(row=>row.recipient_device_id+':'+row.recipient_key_id).sort();
   if(JSON.stringify(actual)!==JSON.stringify(supplied))return new Response('{}',{status:409});
   state.version++;state.active=state.version;result={project_id:projectId,key_version:state.version};
  }else throw new Error('Unexpected RPC '+name);
  return new Response(JSON.stringify(result),{status:200});
 }});
 return createHostedMobileSyncCoordinator({supabaseUrl:'https://synthetic.invalid',publishableKey:'fixture',accessToken:token,projectId,projectRoot:'/synthetic/'+projectId,services:{devices:transport,provisioning:createMobileProjectKeyProvisioningService({transport}),sync:{publishSnapshot:async()=>{events.push({name:'explicit_publish',projectId});return {snapshot_id:'synthetic-snapshot'}},importOutbox:async()=>({imported:[],failures:[]})}}});
}
const books={[book]:coordinator(book),[other]:coordinator(other)};await books[book].refreshKeyState();await books[other].refreshKeyState();
function App(){const [project,setProject]=React.useState(book);const [,tick]=React.useState(0);const [busy,setBusy]=React.useState(false);const current=books[project];return React.createElement('main',null,
 React.createElement('h1',null,'Synthetic companion device review'),React.createElement('button',{onClick:()=>setProject(project===book?other:book)},project===book?'Visit other book':'Return to reviewed book'),
 React.createElement('p',{'data-testid':'book'},project),React.createElement('p',{'data-testid':'key-status'},current.getState().message),
 React.createElement(TrustedDevicesPanel,{key:project,coordinator:current,projectId:project,projectRoot:'/synthetic/'+project,disabled:false,onBusyChange:setBusy,onChanged:()=>tick(x=>x+1)}),
 React.createElement('button',{disabled:busy||current.getState().status!=='ready',onClick:async()=>{await current.publishSnapshot();tick(x=>x+1)}},'Publish reviewed book snapshot'))}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;

test("reviews trusted device revocation and guarded rotation without leaking pending outcomes across books", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/__companion-device-fixture", route => route.fulfill({ contentType: "text/html", body: fixture }));
  await page.goto("/__companion-device-fixture");
  await expect(page.getByRole("heading", { name: "Trusted devices for this book" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh trusted devices" })).toBeEnabled();
  await expect(page.getByText("desktop · This desktop", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish reviewed book snapshot" })).toBeDisabled();
  await page.getByLabel("Expected previous book key version").fill("3");
  await page.getByLabel("Device to revoke").selectOption("10000000-0000-4000-8000-000000000002");
  await expect(page.getByRole("button", { name: "Revoke selected device for this book" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I intend to revoke/ }).check();
  await page.evaluate(() => (window as any).fixture.pause());
  await page.getByRole("button", { name: "Revoke selected device for this book" }).click();
  await expect(page.getByText(/Device operation in progress/)).toBeVisible();
  await page.getByRole("button", { name: "Visit other book" }).click();
  await expect(page.getByText(/Device operation in progress/)).toHaveCount(0);
  await page.getByRole("button", { name: "Return to reviewed book" }).click();
  await expect(page.getByText(/Device operation in progress/)).toBeVisible();
  await page.evaluate(() => (window as any).fixture.release());
  await expect(page.getByText(/Revoked for this book/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish reviewed book snapshot" })).toBeDisabled();
  await page.getByRole("button", { name: "Review book key rotation" }).click();
  const review = page.getByRole("region", { name: "Book key rotation review" });
  await expect(review.getByText("10000000-0000-4000-8000-000000000001", { exact: true })).toBeVisible();
  await expect(review.getByText("10000000-0000-4000-8000-000000000002", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rotate book key for reviewed devices" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I reviewed this version/ }).check();
  await page.getByRole("button", { name: "Rotate book key for reviewed devices" }).click();
  await expect(page.getByText(/Book key 4 created/)).toBeVisible();
  const events = await page.evaluate(() => (window as any).fixture.events);
  expect(events.filter((event: any) => event.name === "mobile_revoke_project_device")).toHaveLength(1);
  const rotations = events.filter((event: any) => event.name === "mobile_rotate_project_key_with_envelopes");
  expect(rotations).toHaveLength(1); expect(rotations[0].args.p_expected_previous_version).toBe(3);
  expect(rotations[0].args.p_envelopes).toHaveLength(1);
  expect(rotations[0].args.p_envelopes[0].recipient_device_id).toBe("10000000-0000-4000-8000-000000000001");
  expect(rotations[0].args.p_envelopes[0].sealed_project_key_hex).toMatch(/^[0-9a-f]{160}$/);
  expect(events.filter((event: any) => event.name === "explicit_publish")).toHaveLength(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("OA1-");
  await page.getByRole("button", { name: "Publish reviewed book snapshot" }).click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).fixture.events)).filter((event: any) => event.name === "explicit_publish").length).toBe(1);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Review book key rotation" }).click();
  await page.getByRole("checkbox", { name: /I reviewed this version/ }).check();
  await page.evaluate(() => (window as any).fixture.drift());
  await page.getByRole("button", { name: "Rotate book key for reviewed devices" }).click();
  await expect(page.getByRole("alert")).toContainText("no automatic retry", { ignoreCase: true });
  await expect(page.getByRole("button", { name: "Review book key rotation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish reviewed book snapshot" })).toBeDisabled();
  await expect(page.getByLabel("Expected previous book key version")).toHaveValue("4");
  await page.getByRole("button", { name: "Visit other book" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Return to reviewed book" }).click();
  await expect(page.getByRole("alert")).toContainText("no automatic retry", { ignoreCase: true });
  await page.getByRole("button", { name: "Refresh trusted devices" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Expected previous book key version")).toHaveValue("4");
  await page.getByLabel("Expected previous book key version").fill("5");
  await page.reload();
  await expect(page.getByLabel("Expected previous book key version")).toHaveValue("5");
  await expect(page.getByText(/Recovered device-management draft/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Book key rotation review" })).toHaveCount(0);
  await page.getByRole("button", { name: "Review book key rotation" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("trusted-device-review-laptop.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});
