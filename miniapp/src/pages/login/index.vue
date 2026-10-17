<template><view class="page"><PageHead title="登录"/><view class="content auth"><view class="hero"><view class="brand">青禾</view><view class="title">好好吃饭，从这里开始</view><view class="subtitle">登录后可下单、查看订单与领取优惠</view></view><view class="tabs"><view :class="['tab',{active:mode==='login'}]" @click="switchMode('login')">登录</view><view :class="['tab',{active:mode==='register'}]" @click="switchMode('register')">注册</view></view><view class="card">
<template v-if="mode==='login'"><text class="label">用户名</text><input v-model="loginForm.account" class="field" placeholder="请输入用户名" maxlength="32"/><text class="label">密码</text><input v-model="loginForm.password" class="field" password placeholder="请输入密码" maxlength="64"/><template v-if="captcha.enabled"><text class="label">验证码</text><view class="captcha-row"><input v-model="loginForm.captchaCode" class="field" placeholder="请输入右侧验证码" maxlength="10"/><image v-if="captcha.img" class="captcha" :src="'data:image/jpeg;base64,'+captcha.img" mode="aspectFit" @click="refreshCaptcha"/><view v-else class="captcha refresh" @click="refreshCaptcha">获取验证码</view></view></template><view v-if="error" class="error">{{error}}</view><button class="btn" :loading="busy" :disabled="busy" @click="doLogin">登录</button></template>
<template v-else><text class="label">用户名</text><input v-model="registerForm.account" class="field" placeholder="4至32位字母、数字或下划线" maxlength="32"/><text class="label">昵称（选填）</text><input v-model="registerForm.nickname" class="field" placeholder="默认：校园食客" maxlength="20"/><text class="label">密码</text><input v-model="registerForm.password" class="field" password placeholder="至少8位，包含字母和数字" maxlength="64"/><text class="label">确认密码</text><input v-model="registerForm.confirm" class="field" password placeholder="请再次输入密码" maxlength="64"/><text class="label">邀请码</text><input v-model="registerForm.inviteCode" class="field" placeholder="请输入管理员提供的邀请码" maxlength="24"/><view class="subtitle">邀请码由管理员生成，每个邀请码仅可注册一次。</view><template v-if="captcha.enabled"><text class="label">验证码</text><view class="captcha-row"><input v-model="registerForm.captchaCode" class="field" placeholder="请输入右侧验证码" maxlength="10"/><image v-if="captcha.img" class="captcha" :src="'data:image/jpeg;base64,'+captcha.img" mode="aspectFit" @click="refreshCaptcha"/><view v-else class="captcha refresh" @click="refreshCaptcha">获取验证码</view></view></template><view v-if="error" class="error">{{error}}</view><button class="btn" :loading="busy" :disabled="busy" @click="doRegister">注册并登录</button></template>
</view><view class="hint small muted">登录遇到问题？请联系管理员重置账号。</view>
<!-- #ifdef MP-WEIXIN --><button class="btn light wechat" :disabled="busy" @click="wechatLogin">微信一键登录</button><!-- #endif -->
</view></view></template>
<script setup>
import {ref,reactive} from 'vue'
import {onLoad} from '@dcloudio/uni-app'
import PageHead from '../../components/PageHead.vue'
import {login,loadConfig,loadCaptcha,webLogin,webRegister,toast} from '../../lib/api'
const mode=ref('login'),busy=ref(false),error=ref(''),redirect=ref('')
const captcha=reactive({enabled:false,uuid:'',img:''})
const loginForm=reactive({account:'',password:'',captchaCode:''})
const registerForm=reactive({account:'',nickname:'',password:'',confirm:'',inviteCode:'',captchaCode:''})
function switchMode(next){if(busy.value||mode.value===next)return;mode.value=next;error.value='';refreshCaptcha()}
async function refreshCaptcha(){
 captcha.uuid='';captcha.img=''
 try{const result=await loadCaptcha();captcha.enabled=!!result.enabled;captcha.uuid=result.uuid||'';captcha.img=result.img||''}
 catch(e){if(!error.value)error.value=e.message}
}
function clearCode(){loginForm.captchaCode='';registerForm.captchaCode=''}
async function doLogin(){
 if(busy.value)return
 error.value=''
 if(!loginForm.account.trim()||!loginForm.password)return error.value='请输入用户名和密码'
 if(captcha.enabled&&!loginForm.captchaCode.trim())return error.value='请输入验证码'
 busy.value=true
 try{await webLogin({account:loginForm.account,password:loginForm.password,captchaCode:loginForm.captchaCode,captchaUuid:captcha.uuid});finish('登录成功')}
 catch(e){error.value=e.message;clearCode();refreshCaptcha()}
 finally{busy.value=false}
}
async function doRegister(){
 if(busy.value)return
 error.value=''
 if(!registerForm.account.trim()||!registerForm.password)return error.value='请输入用户名和密码'
 if(registerForm.password!==registerForm.confirm)return error.value='两次输入的密码不一致'
 if(!registerForm.inviteCode.trim())return error.value='请输入邀请码'
 if(captcha.enabled&&!registerForm.captchaCode.trim())return error.value='请输入验证码'
 busy.value=true
 try{await webRegister({account:registerForm.account,password:registerForm.password,nickname:registerForm.nickname,inviteCode:registerForm.inviteCode,captchaCode:registerForm.captchaCode,captchaUuid:captcha.uuid});finish('注册成功')}
 catch(e){error.value=e.message;clearCode();refreshCaptcha()}
 finally{busy.value=false}
}
function finish(message){
 toast(message)
 const pages=getCurrentPages()
 if(pages.length>1){uni.navigateBack();return}
 const target=redirect.value&&redirect.value.startsWith('/pages/')&&!redirect.value.startsWith('/pages/login/')?redirect.value:'/pages/profile/index'
 uni.reLaunch({url:target})
}
async function wechatLogin(){if(busy.value)return;busy.value=true;error.value='';try{await login();finish('登录成功')}catch(e){error.value=e.message}finally{busy.value=false}}
onLoad(o=>{
 redirect.value=o&&o.redirect?decodeURIComponent(o.redirect):''
 loadConfig().then(c=>{if(c.webLoginEnabled===false)error.value='网站登录暂未开放';refreshCaptcha()}).catch(()=>refreshCaptcha())
})
</script>
<style scoped>.auth{padding-top:20rpx}.hero{text-align:center;padding:25rpx 0 35rpx}.brand{font-size:70rpx;font-weight:700;color:#5f7a4f;letter-spacing:6rpx}.hero .title{margin-top:20rpx}.hero .subtitle{margin-top:12rpx}.tabs{display:flex;background:#eef1e7;border-radius:20rpx;padding:8rpx;margin-bottom:26rpx}.tab{flex:1;text-align:center;padding:18rpx 0;border-radius:14rpx;font-size:27rpx;color:#8b9682}.tab.active{background:#fff;color:#3f7050;font-weight:700;box-shadow:0 2rpx 10rpx #0000000a}.captcha-row{display:flex;align-items:center;gap:16rpx}.captcha-row .field{flex:1;margin-bottom:0}.captcha{width:210rpx;height:82rpx;border-radius:12rpx;background:#f4f6ef;flex-shrink:0}.captcha.refresh{display:flex;align-items:center;justify-content:center;font-size:23rpx;color:#5f7a4f}.hint{text-align:center;margin-top:28rpx}.wechat{margin-top:24rpx}</style>
