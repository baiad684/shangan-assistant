/**
 * 主题初始化脚本。
 *
 * 刻意放在不含 'use client' 的模块里：它要被根布局（服务端组件）直接内联进 <head>，
 * 而 'use client' 模块的非组件导出在服务端拿不到真实值（会变成 client reference）。
 */
export const THEME_STORAGE_KEY = 'shangan.theme';

export const THEME_INIT_SCRIPT = `(function(){try{
var k='${THEME_STORAGE_KEY}';var m=localStorage.getItem(k)||'system';
var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var e=document.documentElement;
if(d){e.classList.add('dark');}e.style.colorScheme=d?'dark':'light';
}catch(e){}})();`;
