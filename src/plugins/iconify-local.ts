import { addCollection } from '@iconify/vue'
import { icons as lucideIcons, type IconifyJSON } from '@iconify-json/lucide'
import { icons as proIcons } from '@iconify-json/proicons'

const lucideIconNames = [
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'arrow-up',
  'arrow-up-right',
  'arrow-right-left',
  'bookmark',
  'bookmark-x',
  'check',
  'check-check',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'chevrons-left',
  'chevrons-right',
  'circle-alert',
  'circle-check',
  'circle-dot',
  'circle-question-mark',
  'circle-x',
  'copy',
  'copy-check',
  'database',
  'download',
  'ellipsis',
  'eye',
  'eye-off',
  'external-link',
  'file',
  'gauge',
  'grip-vertical',
  'hash',
  'image-plus',
  'inbox',
  'info',
  'lightbulb',
  'list-tree',
  'loader-circle',
  'maximize-2',
  'menu',
  'message-square-plus',
  'message-square-text',
  'message-square-code',
  'minimize-2',
  'minus',
  'monitor',
  'moon',
  'panel-left-close',
  'panel-left-open',
  'pencil',
  'pencil-sparkles',
  'picture-in-picture-2',
  'plus',
  'refresh-cw',
  'rotate-ccw',
  'search',
  'settings',
  'send',
  'sparkles',
  'square',
  'sun',
  'table-of-contents',
  'terminal',
  'trash-2',
  'triangle-alert',
  'unplug',
  'upload',
  'x'
]

const localLucideIcons: IconifyJSON = {
  prefix: lucideIcons.prefix,
  width: lucideIcons.width,
  height: lucideIcons.height,
  icons: Object.fromEntries(
    lucideIconNames
      .map(name => [name, lucideIcons.icons[name]])
      .filter((entry): entry is [string, NonNullable<(typeof lucideIcons.icons)[string]>] => Boolean(entry[1]))
  )
}

addCollection(localLucideIcons)

const proIconNames = [
  'dark-theme'
]

const localProIcons: IconifyJSON = {
  prefix: proIcons.prefix,
  width: proIcons.width,
  height: proIcons.height,
  icons: Object.fromEntries(
    proIconNames
      .map(name => [name, proIcons.icons[name]])
      .filter((entry): entry is [string, NonNullable<(typeof proIcons.icons)[string]>] => Boolean(entry[1]))
  )
}

addCollection(localProIcons)
