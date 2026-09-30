import {
  Activity, ArrowRight, ArrowUpRight, Atom, Award, BatteryCharging, Bell, BookOpen, Brain, Briefcase, Building, Calendar,
  Camera, Car, ChartColumn, ChartLine, ChartPie, Check, CircleAlert, CircleCheck, CircleQuestionMark, Clock, Cloud, Code,
  Coffee, Compass, Cpu, CreditCard, Database, DollarSign, Droplets, Eye, Factory, Film, Flag, Flame, FlaskConical, Gauge,
  Gavel, Gift, Globe, GraduationCap, Handshake, Heart, HeartPulse, Image, Info, Key, Laptop, Layers, LayoutGrid, Leaf,
  Lightbulb, Link, Lock, Mail, MapPin, Megaphone, MessageCircle, Microscope, Moon, Mountain, MousePointerClick, Music,
  Package, Phone, PiggyBank, Plane, Puzzle, Quote, Recycle, Rocket, Scale, Search, Server, Settings, Shield, ShieldCheck,
  ShoppingCart, Smartphone, Sparkles, Star, Stethoscope, Sun, Target, Terminal, ThumbsUp, Timer, TrendingDown, TrendingUp,
  TriangleAlert, Trophy, Truck, User, Users, Wallet, Wifi, Wind, Wrench, X, Zap,
  type IconNode,
} from 'lucide'

/**
 * Curated Lucide icons (ISC licence) available to generated decks. Icons are
 * inlined as SVG so previews, thumbnails and HTML exports render identically
 * and offline. Names are kebab-case; unknown names fall back to a neutral dot
 * and are reported as diagnostics instead of failing the slide.
 */
export const iconRegistry = {
  activity: Activity,
  'arrow-right': ArrowRight,
  'arrow-up-right': ArrowUpRight,
  atom: Atom,
  award: Award,
  battery: BatteryCharging,
  bell: Bell,
  book: BookOpen,
  brain: Brain,
  briefcase: Briefcase,
  building: Building,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  'chart-bar': ChartColumn,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  check: Check,
  'check-circle': CircleCheck,
  alert: CircleAlert,
  question: CircleQuestionMark,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  coffee: Coffee,
  compass: Compass,
  cpu: Cpu,
  'credit-card': CreditCard,
  database: Database,
  dollar: DollarSign,
  droplets: Droplets,
  eye: Eye,
  factory: Factory,
  film: Film,
  flag: Flag,
  flame: Flame,
  flask: FlaskConical,
  gauge: Gauge,
  gavel: Gavel,
  gift: Gift,
  globe: Globe,
  graduation: GraduationCap,
  handshake: Handshake,
  heart: Heart,
  health: HeartPulse,
  image: Image,
  info: Info,
  key: Key,
  laptop: Laptop,
  layers: Layers,
  grid: LayoutGrid,
  leaf: Leaf,
  lightbulb: Lightbulb,
  link: Link,
  lock: Lock,
  mail: Mail,
  'map-pin': MapPin,
  megaphone: Megaphone,
  message: MessageCircle,
  microscope: Microscope,
  moon: Moon,
  mountain: Mountain,
  click: MousePointerClick,
  music: Music,
  package: Package,
  phone: Phone,
  savings: PiggyBank,
  plane: Plane,
  puzzle: Puzzle,
  quote: Quote,
  recycle: Recycle,
  rocket: Rocket,
  scale: Scale,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  cart: ShoppingCart,
  smartphone: Smartphone,
  sparkles: Sparkles,
  star: Star,
  stethoscope: Stethoscope,
  sun: Sun,
  target: Target,
  terminal: Terminal,
  'thumbs-up': ThumbsUp,
  timer: Timer,
  'trend-down': TrendingDown,
  'trend-up': TrendingUp,
  warning: TriangleAlert,
  trophy: Trophy,
  truck: Truck,
  user: User,
  users: Users,
  wallet: Wallet,
  wifi: Wifi,
  wind: Wind,
  wrench: Wrench,
  x: X,
  zap: Zap,
} satisfies Record<string, IconNode>

export type IconName = keyof typeof iconRegistry
export const iconNames = Object.keys(iconRegistry).sort() as IconName[]

const SVG_NS = 'http://www.w3.org/2000/svg'

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(iconRegistry, name)
}

/** Builds an inline SVG icon. Unknown names render a neutral dot. */
export function createIcon(doc: Document, name: string, className = 'ms-icon'): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('class', className)
  const node: IconNode = isIconName(name) ? iconRegistry[name] : [['circle', { cx: 12, cy: 12, r: 4 }]]
  for (const [tag, attributes] of node) {
    const child = doc.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) child.setAttribute(key, String(value))
    }
    svg.appendChild(child)
  }
  return svg
}
