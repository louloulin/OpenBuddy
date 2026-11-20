/**
 * Line icons drawn with react-native-svg (20261115-mobile.md §4.3).
 *
 * The phone must not use emoji as affordances: emoji render differently on
 * every OS and read as a toy next to the desktop's lucide line icons. These are
 * 24×24, 1.75 stroke, round caps — the same visual language `lucide-react`
 * gives the desktop window.
 */

import type { ColorValue } from 'react-native'
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg'

export type IconProps = {
  size?: number
  /** Accepts a theme string or a navigator-provided ColorValue. */
  color: ColorValue
  strokeWidth?: number
}

const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' })

export function ChatIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-2.8-.4L4 21l1.4-4.2A8.2 8.2 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  )
}

export function SearchIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={16.5} y1={16.5} x2={21} y2={21} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function BellIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      />
      <Path d="M10.3 21a2 2 0 0 0 3.4 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function PersonIcon({ size = 24, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M4.5 21a7.5 7.5 0 0 1 15 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function SendIcon({ size = 20, color, strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M12 19V5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Polyline points="5.5 11.5 12 5 18.5 11.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function StopIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={7} y={7} width={10} height={10} rx={2} fill={color} />
    </Svg>
  )
}

export function CameraIcon({ size = 22, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.9l1.2-1.8A1.5 1.5 0 0 1 9.9 3.5h4.2a1.5 1.5 0 0 1 1.3.7L16.6 6h1.9A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      />
      <Circle cx={12} cy={12.5} r={3.6} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  )
}

export function MicIcon({ size = 22, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={9} y={2.5} width={6} height={11} rx={3} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1={12} y1={17.5} x2={12} y2={21} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function GlobeIcon({ size = 22, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M3.5 12h17" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.4-3.6-8.5S9.6 5.9 12 3.5Z" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  )
}

export function PlusIcon({ size = 20, color, strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Line x1={12} y1={5} x2={12} y2={19} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1={5} y1={12} x2={19} y2={12} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function CheckIcon({ size = 18, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Polyline points="5 12.5 9.5 17 19 6.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function CloseIcon({ size = 18, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Line x1={6} y1={6} x2={18} y2={18} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1={18} y1={6} x2={6} y2={18} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

/**
 * The back affordance. Screens used to render `ChevronRightIcon` rotated 180°
 * inside a wrapper, which is the same shape but reads as a chevron and cannot
 * take a style prop; an arrow also matches the platform gesture's direction.
 */
export function ArrowLeftIcon({ size = 20, color, strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Line x1={20} y1={12} x2={4.5} y2={12} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Polyline points="10.5 5.5 4 12 10.5 18.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function ChevronRightIcon({ size = 18, color, strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Polyline points="9 5 16 12 9 19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function SparkIcon({ size = 22, color, strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M12 3.2l1.9 5.1 5.1 1.9-5.1 1.9L12 17.2l-1.9-5.1L5 10.2l5.1-1.9L12 3.2Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" fill={color} opacity={0.55} />
    </Svg>
  )
}

export function TerminalIcon({ size = 16, color, strokeWidth = 1.7 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={2.8} y={4.2} width={18.4} height={15.6} rx={2.6} stroke={color} strokeWidth={strokeWidth} />
      <Polyline points="7 10 10 12.5 7 15" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1={12.5} y1={15.2} x2={17} y2={15.2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function CopyIcon({ size = 16, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={9} y={9} width={11} height={11} rx={2.4} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M5.5 15H5a1.6 1.6 0 0 1-1.6-1.6V5A1.6 1.6 0 0 1 5 3.4h8.4A1.6 1.6 0 0 1 15 5v.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function QuoteIcon({ size = 16, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M9.2 6.4c-2.6.9-4.2 2.8-4.2 5.4 0 1.9 1.1 3.1 2.7 3.1 1.4 0 2.4-1 2.4-2.4 0-1.3-.9-2.2-2.1-2.2-.2 0-.4 0-.6.1.3-1.2 1.3-2.1 2.6-2.6zM18.4 6.4c-2.6.9-4.2 2.8-4.2 5.4 0 1.9 1.1 3.1 2.7 3.1 1.4 0 2.4-1 2.4-2.4 0-1.3-.9-2.2-2.1-2.2-.2 0-.4 0-.6.1.3-1.2 1.3-2.1 2.6-2.6z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function ShareIcon({ size = 16, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M12 3.6v10.2M8.2 7.4 12 3.6l3.8 3.8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 12.4v5.4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function FolderIcon({ size = 20, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3.2 7.4a2 2 0 0 1 2-2h3.4l2 2.4h6.2a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function FileIcon({ size = 20, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M6 3.6h7.2L18 8.4v12a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 20.4V5.2A1.6 1.6 0 0 1 6 3.6z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path d="M13.2 3.8v4.6H17.6" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  )
}

export function ClockIcon({ size = 20, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={12} cy={12} r={8.4} stroke={color} strokeWidth={strokeWidth} />
      <Polyline points="12 7.4 12 12 15.4 13.8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function PlayIcon({ size = 16, color, strokeWidth = 1.9 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M8 5.6 18.4 12 8 18.4z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  )
}

export function VolumeIcon({ size = 16, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M11 5 6 9H3v6h3l5 4V5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M15.4 8.7a4.7 4.7 0 0 1 0 6.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M18.2 6.2a8.2 8.2 0 0 1 0 11.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  )
}

export function RefreshIcon({ size = 16, color, strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path d="M20.4 12a8.4 8.4 0 1 1-2.46-5.94" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Polyline points="20.6 3.4 20.6 9 15 9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function LockIcon({ size = 22, color, strokeWidth = 1.75 }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={4.8} y={10.2} width={14.4} height={10} rx={2.2} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M8.2 10.2V7.6a3.8 3.8 0 0 1 7.6 0v2.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx={12} cy={15.2} r={1.1} fill={color} />
    </Svg>
  )
}
