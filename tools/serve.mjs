import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';

const root=await realpath(path.join(path.dirname(fileURLToPath(import.meta.url)),'dist'));
const port=Number(process.env.SAMURAI_PORT||8090);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('SAMURAI_PORT debe ser un puerto válido.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.task':'application/octet-stream'};
const allowedHosts=new Set(['127.0.0.1','localhost','lagan.nicolas16.life']);
const inside=file=>file===root||file.startsWith(root+path.sep);
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
 const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:message);};
 try{
  const host=new URL('http://'+(req.headers.host||'')).hostname.toLowerCase();
  if(!allowedHosts.has(host))return fail(403,'Host no permitido');
  if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return fail(405,'Método no permitido');}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.includes('\0')||pathname.includes('\\'))return fail(400,'Ruta no válida');
  if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(req.method==='HEAD'?undefined:'{"status":"ok"}');}
  const requested=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!inside(requested))return fail(404,'No encontrado');
  const file=await realpath(requested);if(!inside(file))return fail(404,'No encontrado');
  const info=await stat(file);if(!info.isFile())return fail(404,'No encontrado');
  const etag='"'+info.size.toString(16)+'-'+Math.floor(info.mtimeMs).toString(16)+'"';
  const immutable=pathname.startsWith('/assets/')&&/-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(pathname);
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  const detector=pathname.startsWith('/vendor/')||pathname.startsWith('/models/');
  res.setHeader('Cache-Control',immutable?'public, max-age=31536000, immutable':detector?'public, max-age=86400':'no-cache');
  res.setHeader('ETag',etag);res.setHeader('Last-Modified',info.mtime.toUTCString());
  const matches=req.headers['if-none-match']?.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag);
  if(matches){res.writeHead(304);return res.end();}
  res.setHeader('Content-Length',info.size);res.writeHead(200);
  if(req.method==='HEAD')return res.end();
  await pipeline(createReadStream(file),res);
 }catch(error){
  if(res.headersSent){res.destroy();return;}
  if(['ENOENT','ENOTDIR','EACCES'].includes(error.code))return fail(404,'No encontrado');
  if(error instanceof URIError||error instanceof TypeError)return fail(400,'Solicitud no válida');
  fail(500,'No se pudo servir el archivo');
 }
});
server.listen(port,'127.0.0.1',()=>console.log('Samurái listo en http://127.0.0.1:'+port));
server.on('error',error=>{console.error('No se pudo iniciar el servicio:',error.code);process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
