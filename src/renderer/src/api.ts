import type { LiloApi } from '../../shared/api.ts'

declare global {
  interface Window {
    lilo?: LiloApi
  }
}

if (!window.lilo) throw new Error('The renderer was opened without its preload bridge.')

export const api: LiloApi = window.lilo

/** Lets the stylesheet say what only the platform decides, like inset lights. */
document.documentElement.dataset['platform'] = api.platform
