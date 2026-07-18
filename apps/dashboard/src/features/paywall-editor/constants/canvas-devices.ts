import type { StudioCanvasDevice } from "@/features/paywall-editor/types/studio-workspace"

export type CanvasDevicePlatform = "ios" | "android"
export type CanvasDeviceFormFactor = "phone" | "tablet"
export type CanvasDeviceSensor = "dynamic-island" | "bezel-camera" | "punch-hole"
export type CanvasDeviceMaterial = "aluminum" | "graphite" | "pixel" | "galaxy"

export interface CanvasDevicePreset {
  readonly id: StudioCanvasDevice
  readonly label: string
  readonly group: "iPhone" | "iPad" | "Google Pixel" | "Samsung Galaxy"
  readonly platform: CanvasDevicePlatform
  readonly formFactor: CanvasDeviceFormFactor
  readonly displayLabel: string
  readonly portrait: {
    readonly width: number
    readonly height: number
    readonly safeArea: {
      readonly top: number
      readonly right: number
      readonly bottom: number
      readonly left: number
    }
  }
  readonly frame: {
    readonly bezel: number
    readonly outerRadius: number
    readonly screenRadius: number
    readonly sensor: CanvasDeviceSensor
    readonly material: CanvasDeviceMaterial
  }
}

export const CANVAS_DEVICE_PRESETS = [
  {
    id: "iphone-17-pro",
    label: "iPhone 17 Pro",
    group: "iPhone",
    platform: "ios",
    formFactor: "phone",
    displayLabel: '6.3" · 402 × 874 pt',
    portrait: {
      width: 402,
      height: 874,
      safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
    },
    frame: {
      bezel: 10,
      outerRadius: 60,
      screenRadius: 50,
      sensor: "dynamic-island",
      material: "aluminum",
    },
  },
  {
    id: "iphone-17-pro-max",
    label: "iPhone 17 Pro Max",
    group: "iPhone",
    platform: "ios",
    formFactor: "phone",
    displayLabel: '6.9" · 440 × 956 pt',
    portrait: {
      width: 440,
      height: 956,
      safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
    },
    frame: {
      bezel: 10,
      outerRadius: 64,
      screenRadius: 54,
      sensor: "dynamic-island",
      material: "aluminum",
    },
  },
  {
    id: "iphone-17",
    label: "iPhone 17",
    group: "iPhone",
    platform: "ios",
    formFactor: "phone",
    displayLabel: '6.3" · 402 × 874 pt',
    portrait: {
      width: 402,
      height: 874,
      safeArea: { top: 62, right: 0, bottom: 34, left: 0 },
    },
    frame: {
      bezel: 10,
      outerRadius: 58,
      screenRadius: 48,
      sensor: "dynamic-island",
      material: "graphite",
    },
  },
  {
    id: "ipad-pro-11",
    label: 'iPad Pro 11" (M5)',
    group: "iPad",
    platform: "ios",
    formFactor: "tablet",
    displayLabel: '11" · 834 × 1210 pt',
    portrait: {
      width: 834,
      height: 1210,
      safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
    },
    frame: {
      bezel: 18,
      outerRadius: 38,
      screenRadius: 24,
      sensor: "bezel-camera",
      material: "graphite",
    },
  },
  {
    id: "ipad-pro-13",
    label: 'iPad Pro 13" (M5)',
    group: "iPad",
    platform: "ios",
    formFactor: "tablet",
    displayLabel: '13" · 1032 × 1376 pt',
    portrait: {
      width: 1032,
      height: 1376,
      safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
    },
    frame: {
      bezel: 18,
      outerRadius: 40,
      screenRadius: 26,
      sensor: "bezel-camera",
      material: "graphite",
    },
  },
  {
    id: "pixel-10",
    label: "Pixel 10",
    group: "Google Pixel",
    platform: "android",
    formFactor: "phone",
    displayLabel: '6.3" · 20:9',
    portrait: {
      width: 412,
      height: 924,
      safeArea: { top: 32, right: 0, bottom: 24, left: 0 },
    },
    frame: {
      bezel: 9,
      outerRadius: 50,
      screenRadius: 42,
      sensor: "punch-hole",
      material: "pixel",
    },
  },
  {
    id: "pixel-10-pro",
    label: "Pixel 10 Pro",
    group: "Google Pixel",
    platform: "android",
    formFactor: "phone",
    displayLabel: '6.3" · 20:9',
    portrait: {
      width: 412,
      height: 920,
      safeArea: { top: 32, right: 0, bottom: 24, left: 0 },
    },
    frame: {
      bezel: 9,
      outerRadius: 50,
      screenRadius: 42,
      sensor: "punch-hole",
      material: "pixel",
    },
  },
  {
    id: "pixel-10-pro-xl",
    label: "Pixel 10 Pro XL",
    group: "Google Pixel",
    platform: "android",
    formFactor: "phone",
    displayLabel: '6.8" · 20:9',
    portrait: {
      width: 440,
      height: 980,
      safeArea: { top: 32, right: 0, bottom: 24, left: 0 },
    },
    frame: {
      bezel: 9,
      outerRadius: 54,
      screenRadius: 46,
      sensor: "punch-hole",
      material: "pixel",
    },
  },
  {
    id: "galaxy-s26",
    label: "Galaxy S26",
    group: "Samsung Galaxy",
    platform: "android",
    formFactor: "phone",
    displayLabel: '6.3" · 19.5:9',
    portrait: {
      width: 412,
      height: 894,
      safeArea: { top: 30, right: 0, bottom: 24, left: 0 },
    },
    frame: {
      bezel: 8,
      outerRadius: 42,
      screenRadius: 34,
      sensor: "punch-hole",
      material: "galaxy",
    },
  },
  {
    id: "galaxy-s26-plus",
    label: "Galaxy S26+",
    group: "Samsung Galaxy",
    platform: "android",
    formFactor: "phone",
    displayLabel: '6.7" · 19.5:9',
    portrait: {
      width: 432,
      height: 936,
      safeArea: { top: 30, right: 0, bottom: 24, left: 0 },
    },
    frame: {
      bezel: 8,
      outerRadius: 44,
      screenRadius: 36,
      sensor: "punch-hole",
      material: "galaxy",
    },
  },
  {
    id: "galaxy-s26-ultra",
    label: "Galaxy S26 Ultra",
    group: "Samsung Galaxy",
    platform: "android",
    formFactor: "phone",
    displayLabel: '6.9" · 19.5:9',
    portrait: {
      width: 440,
      height: 953,
      safeArea: { top: 30, right: 0, bottom: 24, left: 0 },
    },
    frame: {
      bezel: 8,
      outerRadius: 34,
      screenRadius: 27,
      sensor: "punch-hole",
      material: "galaxy",
    },
  },
] as const satisfies readonly CanvasDevicePreset[]

const DEVICE_PRESET_BY_ID = new Map(
  CANVAS_DEVICE_PRESETS.map((preset) => [preset.id, preset] as const),
)

export const CANVAS_DEVICE_GROUPS = ["iPhone", "iPad", "Google Pixel", "Samsung Galaxy"] as const

export function getCanvasDevicePreset(device: StudioCanvasDevice): CanvasDevicePreset {
  const preset = DEVICE_PRESET_BY_ID.get(device)
  if (!preset) throw new Error(`Unknown Studio canvas device: ${device}`)
  return preset
}
