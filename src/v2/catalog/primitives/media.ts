import { z } from 'zod'

import { el, icon, rich, setVars } from '../dom'
import { isSafeImageUrl } from '../../render/urls'
import { radiusScale, radiusSchema, toneCss, toneSchema } from '../tokens'
import type { PrimitiveDefinition, RenderContext } from '../types'

const urlSchema = z.string().min(1).max(2_000)
const aspects = { '16:9': '16 / 9', '4:3': '4 / 3', '3:2': '3 / 2', '1:1': '1 / 1', '3:4': '3 / 4', '9:16': '9 / 16', '21:9': '21 / 9' } as const
const focusPositions = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' } as const

function lazyImage(context: RenderContext, url: string, className: string, alt: string): HTMLImageElement | null {
  if (!isSafeImageUrl(url)) {
    context.report('unsafe-url', 'Unsafe image URL omitted.')
    return null
  }
  const img = el(context, 'img', className)
  // Reveal lazy-loads data-src for slides near the current one; thumbnails and exports resolve it themselves.
  img.setAttribute('data-src', url)
  img.alt = alt
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  return img
}

const imageProps = z.strictObject({
  src: urlSchema,
  alt: z.string().min(1).max(300),
  fit: z.enum(['cover', 'contain']).optional(),
  aspect: z.enum(['16:9', '4:3', '3:2', '1:1', '3:4', '9:16', '21:9', 'auto', 'fill']).optional(),
  radius: radiusSchema.optional(),
  caption: z.string().min(1).max(200).optional(),
  focus: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional(),
  frame: z.enum(['none', 'shadow', 'border']).optional(),
})

export const imagePrimitive: PrimitiveDefinition<z.infer<typeof imageProps>> = {
  type: 'image',
  category: 'media',
  summary: 'A picture with alt text, crop ratio, fit, focus point, frame and caption.',
  guidance: 'aspect "fill" takes all the height its container offers (ideal in a grid beside text). Generated images are illustrations, never evidence.',
  props: imageProps,
  example: { type: 'image', src: 'https://images.example.com/wind-farm.jpg', alt: 'Offshore wind turbines at dusk', aspect: '4:3', caption: 'Illustration', frame: 'shadow' },
  render(block, context) {
    const aspect = block.aspect ?? 'auto'
    const figure = el(context, 'figure', `ms-image ms-image--${aspect === 'fill' ? 'fill' : aspect === 'auto' ? 'auto' : 'ratio'} ms-image--frame-${block.frame ?? 'none'}`)
    setVars(figure, {
      '--ms-aspect': aspect in aspects ? aspects[aspect as keyof typeof aspects] : undefined,
      '--ms-fit': block.fit ?? 'cover',
      '--ms-focus': focusPositions[block.focus ?? 'center'],
      '--ms-image-radius': radiusScale[block.radius ?? 'lg'],
    })
    const frame = el(context, 'div', 'ms-image__frame')
    const img = lazyImage(context, block.src, 'ms-image__img', block.alt)
    if (img) {
      img.addEventListener('error', () => figure.classList.add('ms-image--failed'))
      frame.appendChild(img)
    } else {
      figure.classList.add('ms-image--failed')
    }
    figure.appendChild(frame)
    if (block.caption) figure.appendChild(el(context, 'figcaption', 'ms-image__caption', block.caption))
    return figure
  },
  outline: (block) => `image: ${block.alt}`,
}

const iconProps = z.strictObject({
  name: z.string().min(1).max(40),
  size: z.enum(['sm', 'md', 'lg', 'xl', '2xl']).optional(),
  tone: toneSchema.optional(),
  variant: z.enum(['plain', 'circle', 'square', 'outline']).optional(),
  label: z.string().min(1).max(80).optional(),
})

const iconSizes = { sm: '28px', md: '40px', lg: '56px', xl: '76px', '2xl': '110px' } as const

export const iconPrimitive: PrimitiveDefinition<z.infer<typeof iconProps>> = {
  type: 'icon',
  category: 'media',
  summary: 'A line icon from the built-in set, bare or on a circle/square badge.',
  guidance: 'Pair icons with feature cards, list items and diagram nodes. Use only names from the icon list.',
  props: iconProps,
  example: { type: 'icon', name: 'leaf', variant: 'circle', tone: 'success', size: 'lg' },
  render(block, context) {
    const node = el(context, 'span', `ms-icon-block ms-icon-block--${block.variant ?? 'plain'}`)
    setVars(node, { '--ms-icon-size': iconSizes[block.size ?? 'md'], '--ms-icon-color': toneCss(block.tone ?? 'accent') })
    node.appendChild(icon(context, block.name))
    if (block.label) {
      node.setAttribute('role', 'img')
      node.setAttribute('aria-label', block.label)
    }
    return node
  },
  outline: (block) => `icon ${block.name}`,
}

const VIDEO_URL = /^https:\/\/[^\s]+\.(?:mp4|webm)(?:[?#][^\s]*)?$/i

const videoProps = z.strictObject({
  src: urlSchema.regex(VIDEO_URL, 'Videos must be https .mp4 or .webm files.'),
  poster: urlSchema.optional(),
  caption: z.string().min(1).max(200).optional(),
  autoplay: z.boolean().optional(),
  loop: z.boolean().optional(),
  aspect: z.enum(['16:9', '4:3', '1:1', '9:16']).optional(),
})

export const videoPrimitive: PrimitiveDefinition<z.infer<typeof videoProps>> = {
  type: 'video',
  category: 'media',
  summary: 'An inline video file (https .mp4/.webm) with poster, looping and muted autoplay.',
  props: videoProps,
  example: { type: 'video', src: 'https://videos.example.com/demo.mp4', autoplay: true, loop: true, caption: 'Product demo' },
  render(block, context) {
    const figure = el(context, 'figure', 'ms-video')
    setVars(figure, { '--ms-aspect': aspects[block.aspect ?? '16:9'] })
    const video = el(context, 'video', 'ms-video__media')
    video.setAttribute('data-src', block.src)
    video.setAttribute('playsinline', '')
    video.setAttribute('preload', 'metadata')
    video.controls = !block.autoplay
    if (block.autoplay) {
      video.muted = true
      video.setAttribute('muted', '')
      video.setAttribute('data-autoplay', '')
    }
    if (block.loop) video.loop = true
    if (block.poster) {
      if (isSafeImageUrl(block.poster)) video.setAttribute('poster', block.poster)
      else context.report('unsafe-url', 'Unsafe video poster omitted.')
    }
    figure.appendChild(video)
    if (block.caption) figure.appendChild(el(context, 'figcaption', 'ms-image__caption', block.caption))
    return figure
  },
  outline: (block) => `video${block.caption ? `: ${block.caption}` : ''}`,
}

const profileProps = z.strictObject({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(160).optional(),
  image: urlSchema.optional(),
  text: z.string().min(1).max(400).optional(),
  variant: z.enum(['card', 'inline']).optional(),
})

export const profilePrimitive: PrimitiveDefinition<z.infer<typeof profileProps>> = {
  type: 'profile',
  category: 'media',
  summary: 'A person: portrait (or initials), name, role and a short bio.',
  guidance: 'For teams, speakers and customer stories. Without an image the initials are shown.',
  props: profileProps,
  example: { type: 'profile', name: 'Ada Lovelace', role: 'Analyst', text: 'Wrote the first published algorithm.' },
  render(block, context) {
    const node = el(context, 'div', `ms-profile ms-profile--${block.variant ?? 'card'}`)
    const avatar = el(context, 'div', 'ms-profile__avatar')
    const img = block.image ? lazyImage(context, block.image, 'ms-profile__img', '') : null
    if (img) avatar.appendChild(img)
    else avatar.textContent = block.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    node.appendChild(avatar)
    const body = el(context, 'div', 'ms-profile__body')
    body.appendChild(el(context, 'strong', 'ms-profile__name', block.name))
    if (block.role) body.appendChild(el(context, 'span', 'ms-profile__role', block.role))
    if (block.text) body.appendChild(rich(context, 'p', 'ms-profile__text', block.text))
    node.appendChild(body)
    return node
  },
  outline: (block) => `${block.name}${block.role ? `, ${block.role}` : ''}`,
}

export const mediaPrimitives = [imagePrimitive, iconPrimitive, videoPrimitive, profilePrimitive]
