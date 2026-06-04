import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import type { ReactNode } from "react";

// Fix default icon paths (Vite + Leaflet)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export const ambulanceIcon = L.divIcon({
  className: "",
  html: `<div style="width:34px;height:34px;border-radius:50%;background:oklch(0.58 0.22 27);border:3px solid white;box-shadow:0 0 0 4px oklch(0.58 0.22 27 / 30%),0 4px 12px rgba(0,0,0,.25);display:grid;place-items:center;color:white;font-size:16px;">🚑</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

export const hospitalIcon = L.divIcon({
  className: "",
  html: `<div style="width:30px;height:30px;border-radius:8px;background:white;border:2px solid oklch(0.58 0.22 27);display:grid;place-items:center;color:oklch(0.58 0.22 27);font-weight:700;">+</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export const accidentIcon = L.divIcon({
  className: "",
  html: `<div style="width:32px;height:32px;border-radius:50%;background:oklch(0.55 0.24 25);border:3px solid white;box-shadow:0 0 0 6px oklch(0.55 0.24 25 / 35%);display:grid;place-items:center;color:white;font-size:18px;font-weight:900;animation:pulse 1.2s ease-in-out infinite;">!</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

export function signalIcon(status: "red" | "yellow" | "green" | "priority_green") {
  const color =
    status === "green" || status === "priority_green"
      ? "oklch(0.62 0.18 150)"
      : status === "yellow"
        ? "oklch(0.78 0.17 80)"
        : "oklch(0.55 0.24 25)";
  const ring = status === "priority_green" ? `box-shadow:0 0 0 6px ${color}40, 0 0 18px ${color};` : "";
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid white;${ring}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

export function CityMap({
  center,
  zoom = 13,
  children,
  recenter = false,
  className = "h-[420px] w-full",
}: {
  center: [number, number];
  zoom?: number;
  children?: ReactNode;
  recenter?: boolean;
  className?: string;
}) {
  return (
    <MapContainer center={center} zoom={zoom} className={className} scrollWheelZoom>
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {recenter && <Recenter center={center} />}
      {children}
    </MapContainer>
  );
}

export { Marker, Polyline, CircleMarker, Circle };
