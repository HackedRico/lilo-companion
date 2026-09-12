import { nativeImage, screen, type NativeImage } from 'electron'
import { PT, SCALES, paint } from './tray-mark.ts'

/**
 * The tray glyph, computed rather than shipped, so there is no binary asset to
 * keep in step with the mark. Every scale the tray might ask for is carried,
 * because Windows wants 18 physical pixels at 100% and downscaling the Retina
 * square to get there turns the stem to mush.
 */
export function trayIcon(): NativeImage {
  const template = process.platform === 'darwin'
  // Windows reads one bitmap and ignores the rest, so the primary one is drawn
  // at the primary display's own scale rather than left to the shell to resize.
  const primary = process.platform === 'win32' ? screen.getPrimaryDisplay().scaleFactor : Math.max(...SCALES)
  const side = Math.round(PT * primary)
  const image = nativeImage.createFromBitmap(paint(side, template), {
    width: side,
    height: side,
    scaleFactor: primary
  })
  for (const scale of SCALES) {
    if (scale === primary) continue
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
