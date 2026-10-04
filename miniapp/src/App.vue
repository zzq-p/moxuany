<script>
import {state,request} from './lib/api'
export default {onLaunch(){if(state.token&&!state.signedOut)request('/me','GET',null,true).catch(()=>{})}}
</script>
<style>@import './styles.css';</style>
