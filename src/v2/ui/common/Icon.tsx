import {
  ArrowDown, ArrowUp, AtSign, Bold, Bookmark, Braces, ChartColumn, Check, ChevronDown, ChevronRight, CircleHelp, CircleStop, Clipboard,
  ClipboardPaste, Code, Columns2, Copy, CopyPlus, CornerLeftUp, Download, Ellipsis, Eye, Flag, Gauge, GripVertical, Hash, Heading, Heading1,
  Highlighter, House, Image, Italic, Keyboard, Layers, LayoutGrid, Link, List, LoaderCircle, Maximize, Milestone, Minus, MessageSquareWarning,
  MoveVertical, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Palette, PencilLine, Pilcrow, Play, Plus, Quote, Redo2, Rows3,
  Scissors, Search, Send, Settings2, Shapes, Sparkles, Square, SquareMousePointer, StickyNote, Strikethrough, Table, Tag, TriangleAlert, Trash2,
  Undo2, UserRound, Video, Workflow, X, type IconNode,
} from 'lucide'

/** Studio chrome icons (Lucide, ISC licence), rendered as inline React SVG. */
const uiIcons = {
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'at-sign': AtSign,
  bold: Bold,
  bookmark: Bookmark,
  braces: Braces,
  'chart-column': ChartColumn,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  help: CircleHelp,
  stop: CircleStop,
  clipboard: Clipboard,
  paste: ClipboardPaste,
  code: Code,
  'columns-2': Columns2,
  copy: Copy,
  duplicate: CopyPlus,
  'corner-left-up': CornerLeftUp,
  download: Download,
  more: Ellipsis,
  eye: Eye,
  flag: Flag,
  gauge: Gauge,
  grip: GripVertical,
  hash: Hash,
  heading: Heading,
  'heading-1': Heading1,
  highlighter: Highlighter,
  home: House,
  image: Image,
  italic: Italic,
  keyboard: Keyboard,
  layers: Layers,
  'layout-grid': LayoutGrid,
  link: Link,
  list: List,
  loader: LoaderCircle,
  maximize: Maximize,
  milestone: Milestone,
  minus: Minus,
  callout: MessageSquareWarning,
  'move-vertical': MoveVertical,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'panel-right-close': PanelRightClose,
  'panel-right-open': PanelRightOpen,
  palette: Palette,
  edit: PencilLine,
  pilcrow: Pilcrow,
  play: Play,
  plus: Plus,
  quote: Quote,
  redo: Redo2,
  'rows-3': Rows3,
  scissors: Scissors,
  search: Search,
  send: Send,
  settings: Settings2,
  shapes: Shapes,
  sparkles: Sparkles,
  square: Square,
  select: SquareMousePointer,
  notes: StickyNote,
  strikethrough: Strikethrough,
  table: Table,
  tag: Tag,
  warning: TriangleAlert,
  trash: Trash2,
  undo: Undo2,
  user: UserRound,
  video: Video,
  workflow: Workflow,
  x: X,
} satisfies Record<string, IconNode>

export type UiIconName = keyof typeof uiIcons

/** Icon for each primitive in menus, layers and chips. */
export const primitiveIcons: Record<string, UiIconName> = {
  stack: 'rows-3',
  grid: 'layout-grid',
  box: 'square',
  heading: 'heading',
  text: 'pilcrow',
  list: 'list',
  quote: 'quote',
  callout: 'callout',
  badge: 'tag',
  divider: 'minus',
  spacer: 'move-vertical',
  image: 'image',
  icon: 'shapes',
  video: 'video',
  profile: 'user',
  stat: 'hash',
  chart: 'chart-column',
  table: 'table',
  progress: 'gauge',
  code: 'code',
  timeline: 'milestone',
  diagram: 'workflow',
  slide: 'layers',
}

export function isUiIconName(name: string): name is UiIconName {
  return Object.prototype.hasOwnProperty.call(uiIcons, name)
}

interface IconProps {
  name: UiIconName | string
  size?: number
  className?: string
  /** Accessible label; decorative when omitted. */
  label?: string
}

export default function Icon({ name, size = 16, className, label }: IconProps) {
  const node: IconNode = isUiIconName(name) ? uiIcons[name] : uiIcons.square
  return (
    <svg
      className={`v2-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {node.map(([tag, attributes], index) => {
        const Tag = tag as 'path'
        return <Tag key={index} {...(attributes as Record<string, string>)} />
      })}
    </svg>
  )
}
