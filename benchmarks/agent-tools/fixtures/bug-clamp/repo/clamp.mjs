export function clamp(value, min, max) {
  if (value < min) return max;
  if (value > max) return min;
  return value;
}
