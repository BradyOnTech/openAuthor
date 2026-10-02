import { test, expect, type Page } from "@playwright/test";

// The rendered panel, author RPC client and companion-account wrapper are real.
// SDK identity and RPC replies are synthetic; SQL authority has separate tests.
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#17191d;color:#e8e9ec;font:14px system-ui}button,input,select{font:inherit}button{padding:8px;margin:3px}input,select{padding:7px;max-width:100%;box-sizing:border-box}#root{max-width:720px;margin:20px auto;padding:20px;border:1px solid #454850}:root{--text-secondary:#c7c9d0;--text-xs:12px;--text-sm:14px}code{font-size:12px}summary{cursor:pointer;padding:8px}
</style></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import RefreshRuntime from '/@react-refresh';
import {createCompanionAccount} from '/src/cloud/account.ts?fixture-original';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const uuid=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
let user=uuid(1),device=uuid(2),sessionId=uuid(3),job=null,loseReply=false,pending=null,identityChanged=null,revoked=false,empty=false,hideCorrection=false,olderJob=null,refuseCorrection=false,accountOnlyAmendable=false;
const events=[],secrets=new Map(),amendmentReceipts=new Map();
const token=()=>btoa('{}')+'.'+btoa(JSON.stringify({sub:user,role:'authenticated',device_id:device,session_id:sessionId,exp:3000000000}))+'.synthetic';
const inventory=()=>{const data={schema_version:1,inventory_sha256:'a'.repeat(64),inventory:{user_id:user,
workspaces:[{workspace_id:uuid(4),name:'Personal workspace',role:'owner',other_members:0,other_owners:0,project_ids:[uuid(5)]},{workspace_id:uuid(7),name:'Ferry collaborators',role:'owner',other_members:1,other_owners:1,project_ids:[uuid(8)]}],
projects:[{project_id:uuid(5),workspace_id:uuid(4),name:'Solo draft',needs_rotation:false,previous_key_version:1,own_outbox_ids:[],project_deletion_job:null},{project_id:uuid(8),workspace_id:uuid(7),name:'The Ferry',needs_rotation:true,previous_key_version:3,own_outbox_ids:[uuid(9)],project_deletion_job:null}],
devices:[{device_id:device,platform:'desktop',device_label:'Review computer'}],existing_project_jobs:[{job_id:uuid(10),project_id:uuid(11),workspace_id:null,phase:'finalized'}]}};if(empty){data.inventory.workspaces=[];data.inventory.projects=[];data.inventory.existing_project_jobs=[]}if(accountOnlyAmendable){data.inventory.workspaces[1].project_ids.push(uuid(22));data.inventory.projects.push({...data.inventory.projects[1],project_id:uuid(22),name:'Archived shared notes',own_outbox_ids:[]})}return data};
const progress=()=>({job_id:uuid(6),phase:empty?'deleting':'awaiting_shared_rotation',inventory_sha256:'a'.repeat(64),blockers:empty?[]:['shared_rotation_required'],projects:empty?[]:[{project_id:uuid(8),name:'The Ferry',action:'retain',phase:'awaiting_rotation',needs_rotation:true,blockers:['key_rotation_required']}]});
const correctionReview=()=>({schema_version:1,job_id:uuid(6),phase:job.phase,base_revision:job.amendment_revision,original_inventory_sha256:'a'.repeat(64),intent_sha256:job.inventory_sha256,review_sha256:'b'.repeat(64),foreign_workspace_name:'Never render foreign workspace names',projects:[
 {project_id:uuid(8),name:'The Ferry',reviewed_workspace_id:uuid(7),effective_workspace_id:uuid(7),current_workspace_id:uuid(21),resolution:'retained',needs_rotation:true,previous_key_version:3,active_key_version:4,remaining_owner:true,independent_deletion:null,allowed_resolution:'retain_current_scope',blockers:[]},
 {project_id:uuid(22),name:'Archived shared notes',reviewed_workspace_id:uuid(7),effective_workspace_id:uuid(7),current_workspace_id:null,resolution:'retained',needs_rotation:true,previous_key_version:3,active_key_version:null,remaining_owner:false,independent_deletion:{job_id:uuid(23),phase:'finalized',backend_verification_sha256:'d'.repeat(64)},allowed_resolution:'attach_finalized_deletion',blockers:[]}
]});
const sdk={auth:{
getSession:async()=>({data:{session:user?{access_token:token(),user:{id:user,email:'synthetic@example.test'}}:null},error:null}),
getClaims:async()=>({data:{claims:{sub:user,role:'authenticated',device_id:device,session_id:sessionId,exp:3000000000}},error:null}),
refreshSession:async()=>({data:{session:{access_token:token(),user:{id:user,email:'synthetic@example.test'}}},error:null}),
onAuthStateChange:callback=>{identityChanged=callback;return {data:{subscription:{unsubscribe(){identityChanged=null}}}}}
},rpc:async(name,args)=>{events.push({name,args});
 if(name==='mobile_get_account_deletion')return {data:hideCorrection?olderJob:job,error:null};
 if(name==='mobile_account_deletion_amendment_preflight')return {data:correctionReview(),error:null};
 if(name==='mobile_get_account_deletion_amendment')return {data:hideCorrection?null:amendmentReceipts.get(args.p_amendment_id)??null,error:null};
 if(name==='mobile_amend_account_deletion'){
  if(refuseCorrection){refuseCorrection=false;return {status:409,data:null,error:{code:'40001',message:'Private destination state',details:null,hint:null}}}
  const receipt={amendment_id:args.p_amendment_id,revision:job.amendment_revision+1,review_sha256:args.p_expected_review_sha256,intent_sha256:'c'.repeat(64)};
  amendmentReceipts.set(args.p_amendment_id,receipt);olderJob=job;
  job={...job,phase:'deleting',inventory_sha256:receipt.intent_sha256,amendment_revision:receipt.revision,amendment_receipt:receipt};
  if(pending)await new Promise(resolve=>{pending=resolve});
  if(loseReply){loseReply=false;throw new Error('Correction reply lost after commit')}
  return {data:receipt,error:null};
 }
 if(name==='mobile_register_device'){device=args.p_device_id;return {data:{id:device},error:null}};
 if(name==='mobile_account_deletion_preflight'){if(revoked)throw new Error('Device revoked');return {data:inventory(),error:null}};
 if(name==='mobile_begin_account_deletion'){
  job=progress();revoked=true;
  if(accountOnlyAmendable)job={...job,phase:'deleting',original_inventory_sha256:'a'.repeat(64),amendment_revision:0,amendment_receipt:null};
  if(pending)await new Promise(resolve=>{pending=resolve});
  if(loseReply){loseReply=false;throw new Error('Reply lost after commit')}
  return {data:job,error:null};
 }
 throw new Error('Unexpected RPC '+name);
}};
window.fixture={events,secrets,account:createCompanionAccount(sdk),empty(){empty=true;device=null;this.setConnected(false)},enrollThenAmend(){accountOnlyAmendable=true;this.setConnected(false)},amendment(){revoked=true;job={...progress(),phase:'auth_ready',original_inventory_sha256:'a'.repeat(64),amendment_revision:0,amendment_receipt:null};this.setConnected(false)},hideCorrection(){hideCorrection=true},revealCorrection(){hideCorrection=false},refuseCorrection(){refuseCorrection=true},lose(){loseReply=true},pause(){pending=true},release(){pending?.();pending=null},refocus(){identityChanged?.('SIGNED_IN',{access_token:token(),user:{id:user,email:'synthetic@example.test'}})},signOut(){user=null;identityChanged?.('SIGNED_OUT',null)},setConnected:null};
const {AccountDeletionPanel}=await import('/src/components/panel/AccountDeletionPanel.tsx');
function App(){const [connected,setConnected]=React.useState(true);window.fixture.setConnected=setConnected;return React.createElement('main',null,
 React.createElement('h1',null,'Synthetic hosted account review'),
 React.createElement(AccountDeletionPanel,{identity:connected?{userId:uuid(1),deviceId:uuid(2)}:null,disabled:false,onRequestPending:()=>events.push({name:'block_hosted_actions'}),onRequested:()=>events.push({name:'confirmed_owned_job'})}))}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;

async function openFixture(page: Page, empty = false, amendment = false, accountOnly = false) {
  await page.route("**/src/cloud/account.ts", route => route.fulfill({ contentType: "application/javascript", body: `export {UUID,cloudSessionId,CompanionRpcRefusal} from '/src/cloud/account.ts?fixture-original';export const cloudConfiguration=()=>({url:'https://synthetic.invalid',publishableKey:'synthetic'});export const desktopAccount=async()=>window.fixture.account;` }));
  await page.route("**/src/cloud/secretStore.ts", route => route.fulfill({ contentType: "application/javascript", body: `export const deploymentScope=async()=>'a'.repeat(64);export const nativeSecrets={get:async key=>window.fixture.secrets.get(key)??null,create:async(key,value)=>{if(!window.fixture.secrets.has(key))window.fixture.secrets.set(key,value);return window.fixture.secrets.get(key)}};` }));
  await page.route("**/__account-deletion", route => route.fulfill({ contentType: "text/html", body: fixture }));
  await page.goto("/__account-deletion");
  if (empty) {
    await expect(page.getByRole("heading")).toBeVisible();
    await page.evaluate(() => (window as any).fixture.empty());
  }
  if (amendment) {
    await expect(page.getByRole("heading")).toBeVisible();
    await page.evaluate(() => (window as any).fixture.amendment());
  }
  if (accountOnly) {
    await expect(page.getByRole("heading")).toBeVisible();
    await page.evaluate(() => (window as any).fixture.enrollThenAmend());
  }
  await page.getByText("Hosted account deletion", { exact: true }).click();
  await page.getByRole("button", { name: amendment ? "Check account deletion status" : "Review hosted account deletion" }).click();
  if (amendment) {
    await expect(page.getByRole("region", { name: "Account deletion progress" })).toBeVisible();
    await page.getByRole("button", { name: "Review changed shared books" }).click();
    await expect(page.getByRole("region", { name: "Changed shared-book scope review" })).toBeVisible();
  } else await expect(page.getByText("Exact hosted inventory")).toBeVisible();
}
async function acknowledge(page: Page) {
  await page.getByRole("checkbox", { name: /I reviewed the retained/ }).check();
  await page.getByRole("checkbox", { name: /I intend to permanently/ }).check();
}

test("reviews exact scope at laptop size and resolves a lost request through owned status after device revocation", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 768 });
  await openFixture(page);
  const request = page.getByRole("button", { name: "Request reviewed account deletion" });
  await expect(request).toBeDisabled();
  await expect(page.getByText(/Personal workspace: Delete workspace/)).toBeVisible();
  await expect(page.getByText(/Ferry collaborators: Leave workspace/)).toBeVisible();
  await expect(page.getByText("Previously approved book deletion")).toBeVisible();
  await expect(page.getByText("a0000000-0000-4000-8000-000000000011", { exact: true })).toBeVisible();
  await expect(page.getByText("Review computer · desktop", { exact: true })).toBeVisible();
  await expect(page.getByText("a0000000-0000-4000-8000-000000000002", { exact: true })).toBeVisible();
  await page.getByRole("combobox").selectOption("remove");
  await acknowledge(page);
  await page.evaluate(() => (window as any).fixture.refocus());
  await expect(request).toBeEnabled();
  await request.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("reviewed-account-deletion-laptop.png"), animations: "disabled" });
  await page.evaluate(() => (window as any).fixture.lose());
  await request.click();
  await expect(page.getByRole("alert")).toHaveText("Reply lost after commit");
  await expect(request).toBeDisabled();
  await expect(page.getByText("Exact hosted inventory")).toBeVisible();
  await page.evaluate(() => (window as any).fixture.refocus());
  await expect(request).toBeDisabled();
  await expect(page.getByText("Exact hosted inventory")).toBeVisible();
  await page.getByRole("button", { name: "Check account deletion status" }).click();
  await expect(page.getByRole("region", { name: "Account deletion progress" })).toBeVisible();
  const events = await page.evaluate(() => (window as any).fixture.events);
  const requests = events.filter((event: any) => event.name === "mobile_begin_account_deletion");
  expect(requests).toHaveLength(1);
  expect(requests[0].args.p_expected_inventory_sha256).toBe("a".repeat(64));
  expect(requests[0].args.p_dispositions.projects).toEqual([{project_id:"a0000000-0000-4000-8000-000000000005",action:"delete",outbox:"preserve"},{project_id:"a0000000-0000-4000-8000-000000000008",action:"retain",outbox:"remove"}]);
  expect(events.filter((event: any) => event.name === "confirmed_owned_job")).toHaveLength(1);
  expect(events.filter((event: any) => event.name === "block_hosted_actions")).toHaveLength(1);
  // Reopening without a device still reads the durable author-owned request.
  await page.evaluate(() => (window as any).fixture.setConnected(false));
  await page.getByRole("button", { name: "Check account deletion status" }).click();
  await expect(page.getByRole("region", { name: "Account deletion progress" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("inventory_sha256");
  expect(errors).toEqual([]);
});

test("sign-out redacts reviewed history and ignores a late begin reply", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openFixture(page); await acknowledge(page);
  await page.evaluate(() => (window as any).fixture.pause());
  await page.getByRole("button", { name: "Request reviewed account deletion" }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fixture.events.filter((event: any) => event.name === "mobile_begin_account_deletion").length)).toBe(1);
  await page.evaluate(() => { (window as any).fixture.signOut(); (window as any).fixture.release(); });
  await expect(page.getByText("Exact hosted inventory")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Account deletion progress" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixture.events.filter((event: any) => event.name === "confirmed_owned_job").length)).toBe(0);
  expect(errors).toEqual([]);
});

test("connects and reviews an account with no hosted books through durable account-only enrollment", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openFixture(page, true);
  await expect(page.getByRole("checkbox", { name: /I reviewed the retained/ })).toHaveCount(0);
  const events = await page.evaluate(() => (window as any).fixture.events);
  expect(events.filter((event: any) => event.name === "mobile_register_device")).toHaveLength(1);
  expect(events.some((event: any) => event.name === "mobile_enroll_project_device" || event.name === "mobile_get_project_key_envelopes")).toBe(false);
  expect(await page.evaluate(() => (window as any).fixture.secrets.size)).toBe(1);
  await page.getByRole("checkbox", { name: /I intend to permanently/ }).check();
  await page.getByRole("button", { name: "Request reviewed account deletion" }).click();
  await expect(page.getByRole("region", { name: "Account deletion progress" })).toBeVisible();
  const submitted = await page.evaluate(() => (window as any).fixture.events.find((event: any) => event.name === "mobile_begin_account_deletion"));
  expect(submitted.args.p_dispositions).toEqual({ workspaces: [], projects: [] });
  expect(JSON.stringify(submitted)).not.toContain("privateKey");
  expect(errors).toEqual([]);
});

async function selectCorrections(page: Page) {
  await page.getByRole("checkbox", { name: "Use this current workspace for retained shared history" }).check();
  await page.getByRole("checkbox", { name: "Record this exact independently finalized deletion receipt" }).check();
  await page.getByRole("checkbox", { name: /I reviewed the selected shared-book corrections/ }).check();
}

test("reviews changed retained scope after device revocation and confirms a lost correction only by exact receipt", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 768 }); await openFixture(page, false, true);
  const submit = page.getByRole("button", { name: "Confirm reviewed shared-book corrections" });
  await expect(submit).toBeDisabled(); await expect(page.getByText(/Never render foreign/)).toHaveCount(0);
  await selectCorrections(page); await page.evaluate(() => (window as any).fixture.refocus()); await expect(submit).toBeEnabled();
  await submit.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath("reviewed-shared-book-corrections-laptop.png"), animations: "disabled" });
  await page.evaluate(() => (window as any).fixture.lose()); await submit.click();
  await expect(page.getByRole("alert")).toHaveText("Correction reply lost after commit");
  await page.evaluate(() => { (window as any).fixture.hideCorrection(); (window as any).fixture.refocus(); });
  await page.getByRole("button", { name: "Check account deletion status" }).click();
  await expect(page.getByText(/existing account request does not confirm/)).toBeVisible(); await expect(submit).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review changed shared books" })).toBeDisabled();
  await page.evaluate(() => (window as any).fixture.revealCorrection());
  await page.getByRole("button", { name: "Check account deletion status" }).click();
  await expect(page.getByText(/correction 1 is confirmed/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Changed shared-book scope review" })).toHaveCount(0);
  const events = await page.evaluate(() => (window as any).fixture.events);
  const amendments = events.filter((event: any) => event.name === "mobile_amend_account_deletion");
  expect(amendments).toHaveLength(1); expect(amendments[0].args.p_expected_revision).toBe(0);
  expect(amendments[0].args.p_resolutions).toEqual([
    {project_id:"a0000000-0000-4000-8000-000000000008",resolution:"retain_current_scope",workspace_id:"a0000000-0000-4000-8000-000000000021"},
    {project_id:"a0000000-0000-4000-8000-000000000022",resolution:"attach_finalized_deletion",project_job_id:"a0000000-0000-4000-8000-000000000023",backend_verification_sha256:"d".repeat(64)},
  ]);
  expect(events.some((event: any) => ["mobile_register_device", "mobile_begin_account_deletion"].includes(event.name))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("review_sha256"); expect(errors).toEqual([]);
});

test("requires a fresh scope review after explicit stale refusal and redacts a late correction on sign-out", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openFixture(page, false, true); await selectCorrections(page);
  await page.evaluate(() => (window as any).fixture.refuseCorrection());
  await page.getByRole("button", { name: "Confirm reviewed shared-book corrections" }).click();
  await expect(page.getByRole("alert")).toContainText("shared-book correction was refused");
  await expect(page.getByRole("region", { name: "Changed shared-book scope review" })).toHaveCount(0);
  await page.getByRole("button", { name: "Review changed shared books" }).click(); await selectCorrections(page);
  await page.evaluate(() => (window as any).fixture.pause());
  await page.getByRole("button", { name: "Confirm reviewed shared-book corrections" }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fixture.events.filter((event: any) => event.name === "mobile_amend_account_deletion").length)).toBe(2);
  await page.evaluate(() => { (window as any).fixture.signOut(); (window as any).fixture.release(); });
  await expect(page.getByRole("region", { name: "Changed shared-book scope review" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Account deletion progress" })).toHaveCount(0);
  await expect(page.getByText(/correction confirmed/)).toHaveCount(0); expect(errors).toEqual([]);
});

test("preserves an account-only enrolled client through reviewed deletion and lost amendment receipt recovery", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openFixture(page, false, false, true); await acknowledge(page);
  await page.getByRole("button", { name: "Request reviewed account deletion" }).click();
  await expect(page.getByRole("region", { name: "Account deletion progress" })).toBeVisible();
  await page.getByRole("button", { name: "Review changed shared books" }).click(); await selectCorrections(page);
  await page.evaluate(() => (window as any).fixture.lose());
  await page.getByRole("button", { name: "Confirm reviewed shared-book corrections" }).click();
  await expect(page.getByRole("alert")).toHaveText("Correction reply lost after commit");
  await page.getByRole("button", { name: "Check account deletion status" }).click();
  await expect(page.getByText(/correction 1 is confirmed/)).toBeVisible();
  const events = await page.evaluate(() => (window as any).fixture.events);
  expect(events.filter((event: any) => event.name === "mobile_register_device")).toHaveLength(1);
  expect(events.filter((event: any) => event.name === "mobile_amend_account_deletion")).toHaveLength(1);
  expect(events.some((event: any) => event.name === "mobile_enroll_project_device")).toBe(false);
  expect(events.filter((event: any) => event.name === "mobile_get_account_deletion_amendment")).toHaveLength(1);
  expect(errors).toEqual([]);
});
