import { test, expect } from "@playwright/test";

// Actual desktop enrollment, public panel, coordinator, published-format crypto
// and RPC adapter run together. Account/Keychain/HTTP are synthetic boundaries;
// SQL authority/locking has separate PostgreSQL evidence.
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#17191d;color:#e8e9ec;font:14px system-ui}button,input,select{font:inherit}button{padding:8px;margin:3px}input,select{padding:7px}#root{max-width:740px;margin:20px auto;padding:20px;border:1px solid #454850}:root{--text-primary:#e8e9ec;--text-secondary:#c7c9d0;--text-tertiary:#b7bbc4;--text-xs:12px;--text-sm:14px;--space-3:12px;--space-4:16px;--border:#454850;--radius-md:6px}
</style></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import sodium from '/node_modules/.vite/deps/libsodium-wrappers.js';
import RefreshRuntime from '/@react-refresh';
import {recoverySnapshotFixture,recoveryManifestRow,recoveryFixtureKey,recoveryFixtureProject} from '/src/mobileSync/recoverySnapshot.fixture.ts';
import {importMobileRecoveryKey} from '/src/mobileSync/projectKeyProvisioning.ts';
RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
await sodium.ready;
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const digest=async b=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',b)));
const book=recoveryFixtureProject,user='30000000-0000-4000-8000-000000000001';
let device=null,keyId=null,publicKey=null,sessionId='80000000-0000-4000-8000-000000000001';
let activeVersion=3,latestVersion=3,corrupt=false,dropReply=false,blockRead=false,pause=false,release=null;
const events=[],envelopes=[],secrets=new Map();
const snapshot=await recoverySnapshotFixture();
const combined=Uint8Array.from(atob(snapshot.ciphertext_base64),c=>c.charCodeAt(0));
const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:combined.slice(0,12),additionalData:new TextEncoder().encode('openauthor.snapshot.v1|'+book+'|revision-one|3')},await importMobileRecoveryKey(recoveryFixtureKey),combined.slice(12));
const prepared={schema_version:1,media_type:'application/vnd.openauthor.mobile-snapshot+json',manifest:snapshot.manifest,plaintext_base64:btoa(String.fromCharCode(...new Uint8Array(plaintext)))};
function token(){return btoa('{}')+'.'+btoa(JSON.stringify({role:'authenticated',sub:user,device_id:device,session_id:sessionId,exp:3000000000}))+'.synthetic'}
async function rpc(name,args){events.push({name,args});
 if(name==='mobile_register_device'){device=args.p_device_id;keyId=args.p_key_id;publicKey=args.p_public_key;return {id:device}}
 if(name==='mobile_enroll_project_device')return {};
 if(name==='mobile_get_project_key_envelopes'){if(blockRead){blockRead=false;throw new Error('Readback temporarily unavailable')}return envelopes}
 if(name==='mobile_get_project_key_state')return {project_id:book,latest_key_version:latestVersion,active_key_version:activeVersion};
 if(name==='mobile_list_project_devices')return [{device_id:device,user_id:user,platform:'desktop',key_id:keyId,key_version:1,key_algorithm:'x25519-v1',public_key:publicKey,public_key_sha256:await digest(sodium.from_hex(publicKey.slice(2))),project_enrolled_at:'2026-10-02T00:00:00Z',project_revoked_at:null}];
 if(name==='mobile_get_recovery_snapshot'){if(args.p_expected_key_version!==activeVersion)throw new Error('Current version changed');return recoveryManifestRow(snapshot)}
 if(name==='mobile_recover_project_key_envelope'){
  if(args.p_expected_key_version!==activeVersion||args.p_expected_device_key_id!==keyId)throw new Error('Current authority changed');
  const row={id:args.p_envelope_id,project_id:book,key_version:3,recipient_device_id:device,recipient_key_id:keyId,sender_device_id:device,algorithm:'x25519-xsalsa20-poly1305-sealedbox-v1',sealed_project_key:'\\\\x'+args.p_sealed_key,sealed_project_key_sha256:await digest(sodium.from_hex(args.p_sealed_key))};envelopes.push(row);
  if(dropReply){dropReply=false;throw new Error('Reply lost after commit')}return row;
 }
 if(name==='mobile_publish_snapshot'){const row={};for(const [k,v] of Object.entries(args))row[k==='p_requesting_device_id'?'created_by_device_id':k.slice(2)]=v;return row}
 throw new Error('Unexpected RPC '+name);
}
const originalFetch=window.fetch.bind(window);window.fetch=async(url,init)=>{
 if(!String(url).startsWith('https://synthetic.invalid'))return originalFetch(url,init);
 if(String(url).includes('/storage/')){
  if(init?.method==='POST'){events.push({name:'storage_upload'});return new Response('{}',{status:200})}
  events.push({name:'storage_download'});if(pause)await new Promise(resolve=>{release=resolve});pause=false;
  return new Response(corrupt?snapshot.ciphertext_base64.slice(1):snapshot.ciphertext_base64);
 }
 const name=String(url).split('/').pop();try{return new Response(JSON.stringify(await rpc(name,JSON.parse(init.body))))}catch(error){if(error.message==='Reply lost after commit')throw error;return new Response('{}',{status:409})}
};
window.fixture={events,secrets,prepared,recoveryKey:recoveryFixtureKey,corrupt(){corrupt=true},repair(){corrupt=false},drop(){dropReply=true},unknown(){dropReply=true;blockRead=true},pause(){pause=true},release(){release?.()},rotate(){latestVersion=4;activeVersion=4},
 scope:{activeProjectId:book,projectRoot:'/synthetic-browser-key-recovery',projectFound:true,setError:()=>{}},account:{
  async session(expected){if(expected&&(expected.userId!==user||expected.deviceId&&expected.deviceId!==device))throw new Error('Wrong account/device');return {userId:user,email:'author@example.com',accessToken:token()}},
  async signIn(){sessionId='80000000-0000-4000-8000-000000000002';return this.session()},async signOut(){throw new Error('Use synthetic sign-in transition')},async refresh(){},rpc
 }};
const {MobileInboxPanel}=await import('/src/components/panel/MobileInboxPanel.tsx');
function App(){const [error,setError]=React.useState('');window.fixture.scope.setError=setError;return React.createElement('main',null,React.createElement('h1',null,'Synthetic book key recovery'),error&&React.createElement('p',{role:'alert'},error),React.createElement(MobileInboxPanel))}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></body></html>`;

async function openFixture(page: import("@playwright/test").Page) {
  await page.route("**/src/api.ts", route => route.fulfill({ contentType: "application/javascript", body: `export const listMobileInboxItems=async()=>[];export const listMobileReviewDecisions=async()=>[];export const prepareMobileSnapshot=async()=>window.fixture.prepared;export const importMobileOutboxItem=async()=>{throw new Error('Unexpected import')};` }));
  await page.route("**/src/contexts/WorkspaceContext.tsx", route => route.fulfill({ contentType: "application/javascript", body: `export const useWorkspace=()=>window.fixture.scope;` }));
  await page.route("**/src/cloud/account.ts", route => route.fulfill({ contentType: "application/javascript", body: `export {UUID,cloudSessionId,CompanionRpcRefusal} from '/src/cloud/account.ts?fixture-original';export const cloudConfiguration=()=>({url:'https://synthetic.invalid',publishableKey:'synthetic'});export const desktopAccount=async()=>window.fixture.account;` }));
  await page.route("**/src/cloud/secretStore.ts", route => route.fulfill({ contentType: "application/javascript", body: `export const hasNativeCredentialStore=()=>true;export const deploymentScope=async()=>'a'.repeat(64);export const nativeSecrets={get:async k=>window.fixture.secrets.get(k)??null,set:async(k,v)=>window.fixture.secrets.set(k,v),create:async(k,v)=>{if(!window.fixture.secrets.has(k))window.fixture.secrets.set(k,v);return window.fixture.secrets.get(k)},remove:async k=>window.fixture.secrets.delete(k)};` }));
  await page.route("**/__companion-key-recovery", route => route.fulfill({ contentType: "text/html", body: fixture }));
  await page.goto("/__companion-key-recovery");
  await page.getByRole("button", { name: "Connect this desktop" }).click();
  await expect(page.getByRole("button", { name: "Reconnect this desktop" })).toBeEnabled();
  await expect(page.getByText(/Current book key 3 is unavailable/)).toBeVisible();
  await page.getByLabel("Recovery key version").fill("3");
  return page.evaluate(() => (window as any).fixture.recoveryKey as string);
}

test("restores an absent envelope via authenticated snapshot proof and exact lost-reply reconciliation before explicit publication", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const recoveryKey = await openFixture(page);
  await expect(page.getByRole("button", { name: "Publish snapshot" })).toBeDisabled();
  // This is another checksum-valid key generated with the real OA1 algorithm.
  const wrongKey = await page.evaluate(async () => {
    const {createMobileProjectKeyProvisioningService}=await import('/src/mobileSync/projectKeyProvisioning.ts');
    const {default:sodium}=await import('/node_modules/.vite/deps/libsodium-wrappers.js');await sodium.ready;
    const pair=sodium.crypto_box_keypair();
    return (await createMobileProjectKeyProvisioningService({transport:{listProjectDevices:async()=>[{deviceId:'synthetic',keyId:'synthetic-key',keyAlgorithm:'x25519-v1',publicKey:sodium.to_base64(pair.publicKey,sodium.base64_variants.URLSAFE_NO_PADDING),projectEnrolledAt:'now',projectRevokedAt:null}],rotateProjectKeyWithEnvelopes:async()=>({keyVersion:3})}}).provisionProjectKey({projectId:'other-book',expectedPreviousVersion:2,reasonCode:'synthetic'})).recoveryKey;
  });
  await page.getByLabel("Recovery key", { exact: true }).fill(wrongKey);
  await page.getByRole("button", { name: "Unlock recovery key" }).click();
  await expect(page.getByRole("alert")).toContainText("could not authenticate");
  await expect(page.getByLabel("Recovery key", { exact: true })).toHaveValue(wrongKey);
  await expect(page.getByRole("button", { name: "Publish snapshot" })).toBeDisabled();
  await page.evaluate(() => (window as any).fixture.corrupt());
  await page.getByLabel("Recovery key", { exact: true }).fill(recoveryKey);
  await page.getByRole("button", { name: "Unlock recovery key" }).click();
  await expect(page.getByRole("alert")).toContainText("incomplete");
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_recover_project_key_envelope').length)).toBe(0);
  await page.evaluate(() => { (window as any).fixture.repair(); (window as any).fixture.drop(); });
  await page.getByRole("button", { name: "Unlock recovery key" }).click();
  await expect(page.getByText("Unlocked key version 3 in memory.")).toBeVisible();
  await expect(page.getByLabel("Recovery key", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Publish snapshot" })).toBeEnabled();
  const prior = await page.evaluate(() => (window as any).fixture.events);
  expect(prior.filter((e:any)=>e.name==='mobile_recover_project_key_envelope')).toHaveLength(1);
  expect(prior.filter((e:any)=>e.name==='mobile_publish_snapshot')).toHaveLength(0);
  expect(JSON.stringify(prior)).not.toContain("OA1-");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("OA1-");
  await page.getByRole("button", { name: "Publish snapshot" }).click();
  await expect(page.getByText("Encrypted snapshot published.")).toBeVisible();
  // A new enrollment connection must actually unseal the installed envelope;
  // this proves recovery restored the normal public path after reconnection.
  await page.getByRole("button", { name: "Reconnect this desktop" }).click();
  await expect(page.getByText("Desktop connected. Current book key 3 is unlocked.")).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_recover_project_key_envelope').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_publish_snapshot').length)).toBe(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Unlock recovery key" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("authenticated-key-recovery-laptop.png"), animations: "disabled" });
  expect(errors).toEqual([]);
});

test("same-account sign-in during pending proof fences the old session and restores deliberate reconnect", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const recoveryKey = await openFixture(page);
  await page.getByRole("button", { name: "Companion account", exact: true }).click();
  await page.getByLabel("Email").fill("author@example.com");
  await page.getByLabel("Password").fill("synthetic-password");
  await page.getByLabel("Recovery key", { exact: true }).fill(recoveryKey);
  await page.evaluate(() => (window as any).fixture.pause());
  await page.getByRole("button", { name: "Unlock recovery key" }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='storage_download').length)).toBe(1);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect this desktop" })).toBeEnabled();
  await expect(page.getByLabel("Recovery key", { exact: true })).toHaveValue("");
  await page.evaluate(() => (window as any).fixture.release());
  await expect(page.getByRole("button", { name: "Publish snapshot" })).toBeDisabled();
  await page.getByRole("button", { name: "Connect this desktop" }).click();
  await expect(page.getByRole("button", { name: "Reconnect this desktop" })).toBeEnabled();
  await expect(page.getByText(/Current book key 3 is unavailable/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_recover_project_key_envelope').length)).toBe(0);
  expect(errors).toEqual([]);
});

test("an indeterminate installation stays locked until deliberate reconnect independently unseals its committed envelope", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const recoveryKey = await openFixture(page);
  await page.getByLabel("Recovery key", { exact: true }).fill(recoveryKey);
  await page.evaluate(() => (window as any).fixture.unknown());
  await page.getByRole("button", { name: "Unlock recovery key" }).click();
  await expect(page.getByRole("alert")).toContainText("installation is unconfirmed");
  await expect(page.getByRole("button", { name: "Publish snapshot" })).toBeDisabled();
  await expect(page.getByLabel("Recovery key", { exact: true })).toHaveValue(recoveryKey);
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_recover_project_key_envelope').length)).toBe(1);
  await page.getByRole("button", { name: "Reconnect this desktop" }).click();
  await expect(page.getByText("Desktop connected. Current book key 3 is unlocked.")).toBeVisible();
  await expect(page.getByLabel("Recovery key", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Publish snapshot" })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_recover_project_key_envelope').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).fixture.events.filter((e:any)=>e.name==='mobile_publish_snapshot').length)).toBe(0);
  expect(errors).toEqual([]);
});
