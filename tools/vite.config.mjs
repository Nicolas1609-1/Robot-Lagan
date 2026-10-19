import {defineConfig} from 'vite';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
export default defineConfig({
 root:project,
 cacheDir:path.join(import.meta.dirname,'.cache/vite'),
 resolve:{alias:[
  {find:/^three\/addons\//,replacement:path.join(import.meta.dirname,'node_modules/three/examples/jsm')+'/'},
  {find:/^three$/,replacement:path.join(import.meta.dirname,'node_modules/three/build/three.module.js')}
 ]},
 server:{host:'127.0.0.1',port:5173,strictPort:true},
 preview:{host:'127.0.0.1',port:5173,strictPort:true},
 build:{outDir:path.join(import.meta.dirname,'dist'),emptyOutDir:true}
});
