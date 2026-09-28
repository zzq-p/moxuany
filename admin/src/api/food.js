import request from '@/utils/request'
export const foodGet=(path,params)=>request({url:'/food/admin'+path,method:'get',params})
export const foodPost=(path,data)=>request({url:'/food/admin'+path,method:'post',data})
export const money=n=>(Number(n||0)/100).toFixed(2)
export const statuses={UNPAID:'待支付',PENDING:'待接单',PREPARING:'制作中',DELIVERING:'配送中',READY:'待取餐',COMPLETED:'已完成',CANCELLED:'已取消'}
