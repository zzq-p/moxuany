import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
export default defineConfig({plugins:[uni()],server:{host:'127.0.0.1',port:5173,proxy:{'/food':{target:'http://127.0.0.1:8080',changeOrigin:true},'/profile':{target:'http://127.0.0.1:8080',changeOrigin:true}}}})
