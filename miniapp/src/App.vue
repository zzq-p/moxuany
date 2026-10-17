<script>
import {state,request,loadConfig} from './lib/api'
export default {onLaunch(){loadConfig().catch(()=>{});if(state.token&&!state.signedOut)request('/me','GET',null,true).catch(()=>{})}}
</script>
<style>@import './styles.css';</style>
