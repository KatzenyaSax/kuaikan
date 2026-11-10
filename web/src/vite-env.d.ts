/// <reference types="vite/client" />

/** 由 vite.config.ts 的 define 注入；Node（tsx）环境下不存在，必须用 typeof 守卫 */
declare const __KUIKAN_API_MOCK__: boolean | undefined
