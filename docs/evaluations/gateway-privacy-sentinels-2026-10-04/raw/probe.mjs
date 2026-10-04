import { SupabaseRpcSessionRateLimiter } from "/private/tmp/openauthor-desktop-grouped-updates/gateway/src/supabaseRateLimiter.ts";
const request={principal:{subject:"author-fiction",tenantId:"tenant-fiction",deviceId:"device-fiction",bearerToken:"private-fiction-token"},projectId:"project-fiction",deviceId:"device-fiction"};
for (const [label,fetchImpl,marker] of [
 ["response", async()=>new Response("private database error",{status:404}),"private database error"],
 ["transport", async()=>{throw new Error("private transport error");},"private transport error"],
 ["extra row", async()=>Response.json({allowed:true,extra:"private"}),"\"extra\":\"private\""],
]) {
 const limiter=new SupabaseRpcSessionRateLimiter({supabaseUrl:"https://fiction.supabase.co",publishableKey:"fiction-publishable",limit:5,windowMs:60000,fetchImpl});
 try {await limiter.consume("opaque",0,request);throw new Error("expected refusal");} catch(error) {
 const serialized=JSON.stringify(error,Object.getOwnPropertyNames(error));
 console.log(JSON.stringify({case:label,message:error.message,ownProperties:Object.getOwnPropertyNames(error),privateSubstring:serialized.includes("private"),privateStackPath:error.stack.includes("file:///private/tmp/"),payloadOrTransportLeak:serialized.includes(marker),bearerLeak:serialized.includes(request.principal.bearerToken),apiKeyLeak:serialized.includes("fiction-publishable")}));
 }
}
