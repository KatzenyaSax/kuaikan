import { useMutation } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import type { OkData, RequestBody } from '@/shared/api/typed'

/** 后端路径前缀：网关 /api/user/** 会 StripPrefix=2，服务端收到 /auth/** */
const BASE = '/api/user/auth'

export type SendCodeBody = RequestBody<'sendRegisterCode'>
export type SendCodeResult = OkData<'sendRegisterCode'>
export type RegisterBody = RequestBody<'register'>
export type RegisterResult = OkData<'register'>

export function sendRegisterCode(body: SendCodeBody): Promise<SendCodeResult> {
  return api.post<SendCodeResult>(`${BASE}/register/code`, body)
}

export function register(body: RegisterBody): Promise<RegisterResult> {
  return api.post<RegisterResult>(`${BASE}/register`, body)
}

export function useSendRegisterCode() {
  return useMutation({ mutationFn: sendRegisterCode })
}

export function useRegister() {
  return useMutation({ mutationFn: register })
}
