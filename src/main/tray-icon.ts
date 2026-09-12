import { nativeImage, type NativeImage } from 'electron'
import { PT, SCALES, paint } from './tray-mark.ts'

/**
 * The tray glyph, computed rather than shipped, so there is no binary asset to
 * keep in step with the mark. Every scale the tray might ask for is carried,
 * because Windows wants 18 physical pixels at 100% and downscaling the Retina
 * square to get there turns the stem to mush.
 */
export function trayIcon(): NativeImage {
  const template = process.platform === 'darwin'
  const biggest = Math.max(...SCALES)
  const image = nativeImage.createFromBitmap(paint(PT * biggest, template), {
    width: PT * biggest,
    height: PT * biggest,
    scaleFactor: biggest
  })
  for (const scale of SCALES) {
    if (scale === biggest) continue
    image.addRepresentation({
      scaleFactor: scale,
      width: PT * scale,
      height: PT * scale,
      buffer: paint(PT * scale, template)
    })
  }
  if (template) image.setTemplateImage(true)
  return image
}
